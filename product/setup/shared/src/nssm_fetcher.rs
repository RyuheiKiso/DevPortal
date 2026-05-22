// このファイルは NSSM バイナリを実行時に HTTP でダウンロードして取得する機能を実装する
// PowerShell スクリプトに頼らず、Rust 実行時に動的に NSSM を入手してキャッシュする

// ファイル操作とパス処理に必要な型をインポートする
use std::path::PathBuf;
// ファイル入出力に必要なトレイトをインポートする
use std::io::{Read, Write};
// DNS 解決タイムアウトのためにスレッドとチャネルをインポートする
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::mpsc;
use std::time::Duration;

// 独自エラー型をインポートする
use crate::error::SetupError;
// 進捗通知のために Reporter をインポートする
use crate::event::Reporter;
// NSSM のキャッシュ先パスを解決するためにインポートする
use crate::paths::nssm_cache_path;

// NSSM 2.24 の公式ダウンロード URL（固定バージョン）
const NSSM_DOWNLOAD_URL: &str = "https://nssm.cc/release/nssm-2.24.zip";

// ダウンロードした ZIP 内の nssm.exe のパス（ZIP 内の相対パス）
const NSSM_ZIP_ENTRY: &str = "nssm-2.24/win64/nssm.exe";

// NSSM 2.24 zip ファイルの期待する SHA-256 ハッシュ値（大文字 16 進数）
// このハッシュと一致しない場合はダウンロードを中断して改ざん等の可能性を通知する
const EXPECTED_SHA256: &str = "727D1E42275C605E0F04ABA98095C38A8E1E46DEF453CDFFCE42869428AA6743";

// ダウンロード時のバッファサイズ（8KB）
const DOWNLOAD_BUF_SIZE: usize = 8 * 1024;

// NSSM が未キャッシュの場合にダウンロードして配置する関数
// reporter: 進捗を通知するための Reporter への参照
// 戻り値: キャッシュされた nssm.exe のフルパス、またはエラー
pub fn ensure_nssm(reporter: &Reporter) -> Result<PathBuf, SetupError> {
    // ダウンロード開始を報告する
    reporter.step_start("nssm_fetch", "NSSM をダウンロードしています…", 3, 0);

    // キャッシュ先ディレクトリを作成する（既に存在する場合は何もしない）
    let cache_path = nssm_cache_path();
    // キャッシュ先ディレクトリを取得する
    let cache_dir = cache_path
        .parent()
        // 親ディレクトリが取得できない場合はエラーを返す
        .ok_or_else(|| {
            SetupError::Other("NSSM キャッシュディレクトリの解決に失敗しました".to_string())
        })?;

    // キャッシュディレクトリを再帰的に作成する（権限不足の場合はエラーが発生する）
    std::fs::create_dir_all(cache_dir).map_err(|e| {
        SetupError::Other(format!(
            "キャッシュディレクトリの作成に失敗しました: {e}\n管理者権限で実行してください。"
        ))
    })?;

    // 進捗を報告する（ダウンロード中: 10%）
    reporter.progress("nssm_fetch", 10, Some("zip をダウンロード中…".to_string()));

    // 一時ファイルのパスを生成する（%TEMP%\devportal-nssm-<uuid>.zip）
    let tmp_zip = std::env::temp_dir().join(format!(
        "devportal-nssm-{}.zip",
        // ランダムな識別子を生成する（uuid クレート不使用のため現在時刻を代用）
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));

    // NSSM zip を HTTP でダウンロードして一時ファイルに保存する
    download_with_progress(reporter, NSSM_DOWNLOAD_URL, &tmp_zip)?;

    // 進捗を報告する（ダウンロード完了: 70%）
    reporter.progress("nssm_fetch", 70, Some("ハッシュを検証中…".to_string()));

    // SHA-256 ハッシュを検証する
    verify_sha256(&tmp_zip)?;

    // 進捗を報告する（検証完了: 80%）
    reporter.progress("nssm_fetch", 80, Some("zip を展開中…".to_string()));

    // ZIP を展開して nssm.exe をキャッシュ先に配置する
    extract_nssm_from_zip(&tmp_zip, &cache_path)?;

    // 一時 ZIP ファイルを削除する（失敗してもエラーにしない）
    let _ = std::fs::remove_file(&tmp_zip);

    // 完了を報告する
    reporter.step_done("nssm_fetch", 0);
    // 進捗を報告する（完了: 100%）
    reporter.progress(
        "nssm_fetch",
        100,
        Some(format!("NSSM を配置しました: {}", cache_path.display())),
    );

    // キャッシュパスを返す
    Ok(cache_path)
}

// DNS 名前解決を別スレッドで実行して 10 秒でタイムアウトさせるヘルパー関数
// ureq のデフォルト StdResolver は同期 to_socket_addrs を直接呼ぶため
// Windows DNS スタブが応答しない場合に OS デフォルト（数分〜）まで返ってこない
// この関数を Resolver として差し込むことで DNS ハングを 10 秒以内に打ち切る
fn resolve_with_timeout(netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
    // netloc は "hostname:port" 形式（ureq が構築して渡す）
    let netloc = netloc.to_string();
    // 結果を受け渡す mpsc チャネルを作成する
    let (tx, rx) = mpsc::channel();
    // ブロッキング to_socket_addrs を別スレッドで実行する
    std::thread::spawn(move || {
        // DNS 解決を実行して結果をチャネルに送信する
        let result = netloc
            .to_socket_addrs()
            .map(|iter| iter.collect::<Vec<_>>());
        // 受信側がタイムアウトでドロップ済みでもパニックしないよう let _ で握り潰す
        let _ = tx.send(result);
    });
    // 10 秒以内に結果が届かなければタイムアウトエラーを返す
    match rx.recv_timeout(Duration::from_secs(10)) {
        // DNS 解決成功
        Ok(Ok(addrs)) => Ok(addrs),
        // DNS 解決失敗（ホスト不明など）
        Ok(Err(e)) => Err(e),
        // タイムアウト
        Err(_) => Err(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "DNS 解決が 10 秒以内に完了しませんでした",
        )),
    }
}

// ZIP ファイルを HTTP でダウンロードしてファイルに保存するヘルパー関数
// reporter: 進捗を通知するための Reporter
// url: ダウンロード URL
// dest: 保存先ファイルパス
fn download_with_progress(
    reporter: &Reporter,
    url: &str,
    dest: &PathBuf,
) -> Result<(), SetupError> {
    // タイムアウト設定付き AgentBuilder を構築する
    let mut builder = ureq::AgentBuilder::new()
        // DNS 解決を別スレッドで 10 秒以内に打ち切るカスタムリゾルバを設定する
        // ureq のデフォルト StdResolver は同期 DNS なので DNS ハングを防ぐために差し替える
        .resolver(resolve_with_timeout as fn(&str) -> std::io::Result<Vec<SocketAddr>>)
        // TCP 接続確立が 15 秒以内に完了しない場合にエラーとする
        .timeout_connect(Duration::from_secs(15))
        // 各 read 呼び出しが 60 秒以内に応答しない場合にエラーとする
        .timeout_read(Duration::from_secs(60));

    // HTTPS_PROXY / HTTP_PROXY 環境変数を確認してプロキシを設定する
    // 大文字優先で確認し、見つかれば ureq エージェントに登録する
    let proxy_url = std::env::var("HTTPS_PROXY")
        .or_else(|_| std::env::var("https_proxy"))
        .or_else(|_| std::env::var("HTTP_PROXY"))
        .or_else(|_| std::env::var("http_proxy"))
        .ok();
    // プロキシ URL が設定されている場合はエージェントに反映する
    if let Some(proxy_str) = proxy_url {
        // ureq::Proxy への変換を試みる（失敗時はプロキシなしで継続する）
        if let Ok(proxy) = ureq::Proxy::new(&proxy_str) {
            // プロキシを AgentBuilder に設定する
            builder = builder.proxy(proxy);
        }
    }

    // AgentBuilder からエージェントを構築して HTTP GET を実行する
    let agent = builder.build();
    // HTTP GET リクエストを送信する
    let response = agent
        .get(url)
        .call()
        // HTTP エラーを SetupError::Other に変換する
        .map_err(|e| {
            SetupError::Other(format!(
                "NSSM のダウンロードに失敗しました: {e}\n\
            ・社内プロキシ環境では HTTPS_PROXY 環境変数を設定してください\n\
            ・オフライン環境では DEVPORTAL_NSSM_PATH 環境変数で nssm.exe のパスを指定してください"
            ))
        })?;

    // Content-Type ヘッダーを確認する（HTML が返ってきた場合はサーバーエラーページと判断する）
    if let Some(ct) = response.header("Content-Type") {
        // text/html が含まれていれば ZIP ファイルではない
        if ct.contains("text/html") {
            return Err(SetupError::Other(format!(
                "NSSM ダウンロードサーバーがエラーページを返しました（Content-Type: {ct}）。\n\
                サーバーが一時的に停止している可能性があります。\n\
                ・しばらく時間をおいてから再試行してください\n\
                ・オフライン環境では DEVPORTAL_NSSM_PATH 環境変数で nssm.exe のパスを指定してください"
            )));
        }
    }

    // Content-Length ヘッダーから合計ファイルサイズを取得する（取得できない場合は None）
    let total_bytes: Option<u64> = response
        .header("Content-Length")
        // ヘッダーが存在する場合は u64 にパースを試みる
        .and_then(|v| v.parse().ok());

    // 保存先ファイルを作成する
    let mut out_file = std::fs::File::create(dest).map_err(SetupError::Io)?;

    // レスポンスボディを Read として取得する
    let mut reader = response.into_reader();

    // 読み込み済みバイト数を追跡するカウンタ
    let mut downloaded_bytes: u64 = 0;

    // バッファを確保する
    let mut buf = vec![0u8; DOWNLOAD_BUF_SIZE];

    // ストリーミングでバッファごとに読み込む
    loop {
        // バッファにデータを読み込む
        let n = reader.read(&mut buf).map_err(SetupError::Io)?;

        // 読み込みサイズが 0 なら EOF（ダウンロード完了）
        if n == 0 {
            // ループを終了する
            break;
        }

        // 読み込んだデータをファイルに書き込む
        out_file.write_all(&buf[..n]).map_err(SetupError::Io)?;

        // 読み込み済みバイト数を更新する
        downloaded_bytes += n as u64;

        // 合計サイズが分かる場合はパーセントを計算して進捗を報告する
        if let Some(total) = total_bytes {
            // 0〜60% の範囲でダウンロード進捗を表示する（10% 開始、70% 終了予定）
            let dl_percent = (downloaded_bytes as f64 / total as f64 * 60.0) as u8 + 10;
            // 定期的に進捗を通知する（全バイト更新より間引く）
            if downloaded_bytes % (DOWNLOAD_BUF_SIZE as u64 * 32) == 0 {
                // 進捗パーセントを通知する
                reporter.progress("nssm_fetch", dl_percent, None);
            }
        }
    }

    // ファイルのフラッシュを確実に行う
    out_file.flush().map_err(SetupError::Io)?;

    // 正常終了を返す
    Ok(())
}

// ダウンロードした ZIP ファイルの SHA-256 ハッシュを検証するヘルパー関数
// zip_path: 検証対象の ZIP ファイルパス
fn verify_sha256(zip_path: &PathBuf) -> Result<(), SetupError> {
    // sha2 クレートの Sha256 ハッシャーを使用する
    use sha2::Digest;

    // ファイルを開く
    let mut file = std::fs::File::open(zip_path).map_err(SetupError::Io)?;

    // SHA-256 ハッシャーを初期化する
    let mut hasher = sha2::Sha256::new();

    // バッファを確保する
    let mut buf = vec![0u8; DOWNLOAD_BUF_SIZE];

    // ファイル全体を読み込んでハッシュを計算する
    loop {
        // バッファにデータを読み込む
        let n = file.read(&mut buf).map_err(SetupError::Io)?;
        // EOF に達したらループを終了する
        if n == 0 {
            break;
        }
        // 読み込んだデータをハッシャーに追加する
        hasher.update(&buf[..n]);
    }

    // ハッシュ値を確定して 16 進数文字列に変換する
    let hash_bytes = hasher.finalize();
    // 大文字 16 進数に変換する（期待値と同じ形式）
    let actual_hash = format!("{:X}", hash_bytes);

    // 期待するハッシュ値と比較する
    if actual_hash != EXPECTED_SHA256 {
        // 一致しない場合は改ざん等の可能性を通知してエラーを返す
        return Err(SetupError::Other(format!(
            "NSSM の SHA-256 ハッシュが一致しません。\n期待値: {}\n実際値: {}\n\
            ファイルが改ざんされた可能性があります。一時ファイルを削除して再試行してください。",
            EXPECTED_SHA256, actual_hash
        )));
    }

    // 検証成功を返す
    Ok(())
}

// ZIP ファイルから nssm.exe を取り出してキャッシュ先に配置するヘルパー関数
// zip_path: 展開元の ZIP ファイルパス
// dest: 配置先のフルパス（nssm.exe のファイルパス）
fn extract_nssm_from_zip(zip_path: &PathBuf, dest: &PathBuf) -> Result<(), SetupError> {
    // zip クレートで ZIP アーカイブを開く
    let zip_file = std::fs::File::open(zip_path).map_err(SetupError::Io)?;

    // ZIP アーカイブとして解析する
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| SetupError::Other(format!("ZIP ファイルのオープンに失敗しました: {e}")))?;

    // 目的のエントリ（win64/nssm.exe）を名前で取得する
    let mut entry = archive.by_name(NSSM_ZIP_ENTRY).map_err(|e| {
        SetupError::Other(format!(
            "ZIP 内に '{}' が見つかりませんでした: {e}",
            NSSM_ZIP_ENTRY
        ))
    })?;

    // 出力先のファイルを作成する
    let mut out_file = std::fs::File::create(dest).map_err(SetupError::Io)?;

    // ZIP エントリの内容を出力先ファイルにコピーする
    std::io::copy(&mut entry, &mut out_file).map_err(SetupError::Io)?;

    // 正常終了を返す
    Ok(())
}
