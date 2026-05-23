// このファイルは BaGet NuGet レジストリの SetupEngine 実装を定義する
// NSSM を使って BaGet を Windows サービスとしてインストール・管理する

// ファイルシステム操作に必要な型をインポートする
use std::fs;

// ファイル読み書きに必要なトレイトをインポートする
use std::io::{Read, Write};

// ネットワーク接続確認に必要な型をインポートする
use std::net::TcpStream;

// SocketAddr と ToSocketAddrs を DNS 解決タイムアウトに使用する
use std::net::{SocketAddr, ToSocketAddrs};

// DNS 解決タイムアウトのためにスレッドとチャネルをインポートする
use std::sync::mpsc;

// 標準時間型をインポートする（タイムアウト・待機処理・経過時間計測に使用）
use std::time::{Duration, Instant};

// ファイルシステムパスを扱うために PathBuf を使用する
use std::path::{Path, PathBuf};

// 独自エラー型を参照するために使用する
use crate::error::SetupError;

// 進捗イベント送信と型を参照するために使用する
use crate::event::{ActionKind, Component, Reporter};

// セットアップ設定構造体を参照するために使用する
use crate::config::SetupConfig;

// コンポーネントステータス構造体と SetupEngine トレイトを参照するために使用する
use crate::engine::{ComponentStatus, SetupEngine};

// NSSM ラッパ構造体を参照するために使用する
use crate::nssm::Nssm;

// パス解決関数を参照するために使用する
use crate::paths;

// BaGet の GitHub Releases からダウンロードする ZIP の URL テンプレート
// {version} を実際のバージョン文字列で置換して使用する
const BAGET_DOWNLOAD_URL_TEMPLATE: &str =
    "https://github.com/loic-sharma/BaGet/releases/download/v{version}/BaGet.zip";

// BaGet の appsettings.json テンプレート文字列
// {packages_dir}, {db_dir}, {port} をそれぞれの実際の値で置換して使用する
// Mirror セクションは BaGet 0.4.0-preview2 で必須（Enabled: false でアップストリームミラーを無効化）
const BAGET_APPSETTINGS_TEMPLATE: &str = r#"{
  "ApiKey": "",
  "Storage": { "Type": "FileSystem", "Path": "{packages_dir}" },
  "Database": { "Type": "Sqlite", "ConnectionString": "Data Source={db_dir}/baget.db" },
  "Search": { "Type": "Database" },
  "Mirror": { "Enabled": false },
  "Urls": "http://0.0.0.0:{port}"
}
"#;

// ダウンロード時のバッファサイズ（8KB）
const DOWNLOAD_BUF_SIZE: usize = 8 * 1024;

// BaGetEngine: BaGet NuGet レジストリの SetupEngine 実装構造体
// フィールドを持たないユニット構造体として定義する
pub struct BaGetEngine;

// BaGetEngine のプライベートヘルパーメソッド実装ブロック
impl BaGetEngine {
    // dotnet.exe のフルパスを解決するヘルパーメソッド
    // where.exe を使って PATH 上の dotnet.exe を検索し、見つからない場合は既定パスを確認する
    fn find_dotnet_exe() -> Result<PathBuf, SetupError> {
        // Windows 専用実装に委譲する
        Self::find_dotnet_exe_impl()
    }

    // Windows 向けの dotnet.exe 解決実装
    #[cfg(windows)]
    fn find_dotnet_exe_impl() -> Result<PathBuf, SetupError> {
        // where.exe で dotnet.exe のフルパスを検索する
        if let Ok(output) = std::process::Command::new("where.exe")
            .arg("dotnet.exe")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            // where.exe が成功した場合は最初の候補パスを使用する
            if output.status.success() {
                let path_str = String::from_utf8_lossy(&output.stdout).to_string();
                // 最初の行（最初に見つかったパス）を取得する
                if let Some(first) = path_str.lines().next() {
                    let trimmed = first.trim();
                    // 空でなければそのパスを返す
                    if !trimmed.is_empty() {
                        return Ok(PathBuf::from(trimmed));
                    }
                }
            }
        }
        // where.exe が失敗した場合は .NET のデフォルトインストールパスを確認する
        let default_path = PathBuf::from(r"C:\Program Files\dotnet\dotnet.exe");
        if default_path.exists() {
            return Ok(default_path);
        }
        // どちらも失敗した場合はエラーを返す
        Err(SetupError::Other(
            ".NET ランタイムが見つかりません。.NET 8 以降をインストールしてください。\n\
             ダウンロード: https://dotnet.microsoft.com/download/dotnet/8.0"
                .to_string(),
        ))
    }

    // Windows 以外のプラットフォーム向けのスタブ（テスト・CI 用）
    #[cfg(not(windows))]
    fn find_dotnet_exe_impl() -> Result<PathBuf, SetupError> {
        // Unix 系環境では dotnet コマンドをそのまま返す
        Ok(PathBuf::from("dotnet"))
    }

    // BaGet.runtimeconfig.json に rollForward: Major を追記するヘルパーメソッド
    // BaGet 0.4.0-preview2 は .NET Core 3.1 ターゲットだが、
    // 実環境では .NET 8 以降のみが利用可能な場合があるため Major ロールフォワードを有効にする
    fn patch_runtimeconfig(baget_app_dir: &Path) -> Result<(), SetupError> {
        // runtimeconfig.json のパスを構築する
        let config_path = baget_app_dir.join("BaGet.runtimeconfig.json");
        // ファイルが存在しない場合はスキップする（旧バージョンとの互換性）
        if !config_path.exists() {
            return Ok(());
        }
        // ファイル内容を文字列として読み込む
        let content = fs::read_to_string(&config_path).map_err(SetupError::Io)?;
        // JSON としてパースする
        let mut json: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
            SetupError::Other(format!(
                "BaGet.runtimeconfig.json のパースに失敗しました: {e}"
            ))
        })?;
        // runtimeOptions.rollForward = "Major" を追加する（既存値は上書きする）
        if let Some(opts) = json
            .get_mut("runtimeOptions")
            .and_then(|v| v.as_object_mut())
        {
            // Major ロールフォワードを有効にして .NET 8+ で動作できるようにする
            opts.insert(
                "rollForward".to_string(),
                serde_json::Value::String("Major".to_string()),
            );
        }
        // 更新した JSON を整形して書き戻す
        let updated = serde_json::to_string_pretty(&json).map_err(|e| {
            SetupError::Other(format!(
                "BaGet.runtimeconfig.json のシリアライズに失敗しました: {e}"
            ))
        })?;
        fs::write(&config_path, updated).map_err(SetupError::Io)?;
        Ok(())
    }

    // ヘルスチェックを TCP 接続で実施するヘルパーメソッド
    // 最大 max_retries 回リトライし、成功したら true を返す
    fn wait_for_tcp(host: &str, port: u16, max_retries: u32, interval_secs: u64) -> bool {
        // 接続先のアドレス文字列を構築する
        let addr = format!("{}:{}", host, port);
        // リトライ回数をカウントする変数
        let mut attempt = 0u32;
        // 最大リトライ回数に達するまでループする
        while attempt < max_retries {
            // TCP 接続を試みる（タイムアウトを interval_secs の半分に設定）
            let timeout = Duration::from_secs(interval_secs / 2 + 1);
            // TcpStream::connect_timeout で TCP 接続を確認する
            if TcpStream::connect_timeout(
                // アドレスを SocketAddr にパースして渡す
                &addr
                    .parse()
                    .unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap()),
                // タイムアウト時間を設定する
                timeout,
            )
            .is_ok()
            {
                // 接続に成功したら true を返す
                return true;
            }
            // 接続に失敗した場合は待機してからリトライする
            std::thread::sleep(Duration::from_secs(interval_secs));
            // リトライカウントをインクリメントする
            attempt += 1;
        }
        // 最大リトライ回数に達しても接続できなかった場合は false を返す
        false
    }

    // DNS 名前解決を別スレッドで実行して 10 秒でタイムアウトさせるヘルパー関数
    // netloc は "hostname:port" 形式で渡される
    fn resolve_with_timeout(netloc: &str) -> std::io::Result<Vec<SocketAddr>> {
        // netloc を String にコピーしてスレッドに移動する
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

    // BaGet の ZIP ファイルを HTTP でダウンロードして保存するヘルパーメソッド
    // reporter: 進捗を通知するための Reporter への参照
    // url: ダウンロード URL
    // dest: 保存先ファイルパス
    fn download_zip(reporter: &Reporter, url: &str, dest: &PathBuf) -> Result<(), SetupError> {
        // タイムアウト設定付き AgentBuilder を構築する
        let mut builder = ureq::AgentBuilder::new()
            // DNS 解決を別スレッドで 10 秒以内に打ち切るカスタムリゾルバを設定する
            .resolver(Self::resolve_with_timeout as fn(&str) -> std::io::Result<Vec<SocketAddr>>)
            // TCP 接続確立が 15 秒以内に完了しない場合にエラーとする
            .timeout_connect(Duration::from_secs(15))
            // 各 read 呼び出しが 60 秒以内に応答しない場合にエラーとする
            .timeout_read(Duration::from_secs(60));

        // HTTPS_PROXY / HTTP_PROXY 環境変数を確認してプロキシを設定する
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
                    "BaGet のダウンロードに失敗しました: {e}\n\
                    ・社内プロキシ環境では HTTPS_PROXY 環境変数を設定してください\n\
                    ・オフライン環境では DEVPORTAL_BAGET_PATH 環境変数で ZIP のパスを指定してください"
                ))
            })?;

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
                // 0〜90% の範囲でダウンロード進捗を表示する
                let dl_percent = (downloaded_bytes as f64 / total as f64 * 90.0) as u8;
                // 定期的に進捗を通知する（全バイト更新より間引く）
                if downloaded_bytes.is_multiple_of(DOWNLOAD_BUF_SIZE as u64 * 32) {
                    // 進捗パーセントを通知する
                    reporter.progress("baget_fetch", dl_percent, None);
                }
            }
        }

        // ファイルのフラッシュを確実に行う
        out_file.flush().map_err(SetupError::Io)?;

        // 正常終了を返す
        Ok(())
    }

    // ZIP ファイルを展開して全エントリを dest_dir に書き出すヘルパーメソッド
    // zip_path: 展開元の ZIP ファイルパス
    // dest_dir: 展開先ディレクトリ
    fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), SetupError> {
        // zip クレートで ZIP アーカイブを開く
        let zip_file = std::fs::File::open(zip_path).map_err(SetupError::Io)?;

        // ZIP アーカイブとして解析する
        let mut archive = zip::ZipArchive::new(zip_file)
            .map_err(|e| SetupError::Other(format!("ZIP ファイルのオープンに失敗しました: {e}")))?;

        // アーカイブ内の全エントリを処理する
        for i in 0..archive.len() {
            // インデックスでエントリを取得する
            let mut entry = archive.by_index(i).map_err(|e| {
                SetupError::Other(format!("ZIP エントリの読み込みに失敗しました: {e}"))
            })?;

            // エントリのパス名を取得する
            let entry_name = entry.name().to_string();

            // 展開先のフルパスを構築する
            let out_path = dest_dir.join(&entry_name);

            // エントリがディレクトリの場合は作成して次に進む
            if entry.is_dir() {
                // ディレクトリを再帰的に作成する
                fs::create_dir_all(&out_path).map_err(SetupError::Io)?;
                // 次のエントリに進む
                continue;
            }

            // ファイルの親ディレクトリが存在することを確認する
            if let Some(parent) = out_path.parent() {
                // 親ディレクトリを再帰的に作成する
                fs::create_dir_all(parent).map_err(SetupError::Io)?;
            }

            // 出力ファイルを作成する
            let mut out_file = std::fs::File::create(&out_path).map_err(SetupError::Io)?;

            // ZIP エントリの内容を出力ファイルにコピーする
            std::io::copy(&mut entry, &mut out_file).map_err(SetupError::Io)?;
        }

        // 正常終了を返す
        Ok(())
    }
}

// SetupEngine トレイトの BaGetEngine への実装
impl SetupEngine for BaGetEngine {
    // コンポーネント名を返す（ログ表示用）
    fn name(&self) -> &str {
        // BaGet コンポーネントの表示名を返す
        "BaGet"
    }

    // Windows サービスの識別名を返す
    // config.service_prefix と "BaGet" を連結した名前を使用する
    fn service_name(&self, config: &SetupConfig) -> String {
        // サービスプレフィックスと BaGet を連結してサービス名を生成する
        format!("{}-BaGet", config.service_prefix)
    }

    // BaGet をインストールして Windows サービスとして登録する
    fn install(&self, config: &SetupConfig, reporter: &Reporter) -> Result<(), SetupError> {
        // サービス名を取得する
        let service_name = self.service_name(config);

        // ステップ 0: 必要なディレクトリを作成する
        let step_t = Instant::now();
        reporter.step_start("baget_dirs", "BaGet ディレクトリを作成しています", 6, 0);

        // BaGet のバイナリ展開先ディレクトリを取得する
        let baget_app_dir = paths::baget_app_dir(config);
        // BaGet のパッケージストレージディレクトリを取得する
        let baget_packages_dir = paths::baget_packages_dir(config);
        // BaGet の SQLite DB 格納先ディレクトリを取得する
        let baget_data_dir = paths::baget_data_dir(config);
        // BaGet のログ出力ディレクトリを取得する
        let baget_logs_dir = paths::baget_logs_dir(config);

        // バイナリ展開先ディレクトリを再帰的に作成する
        fs::create_dir_all(&baget_app_dir)?;
        // パッケージストレージディレクトリを再帰的に作成する
        fs::create_dir_all(&baget_packages_dir)?;
        // SQLite DB 格納先ディレクトリを再帰的に作成する
        fs::create_dir_all(&baget_data_dir)?;
        // ログ出力ディレクトリを再帰的に作成する
        fs::create_dir_all(&baget_logs_dir)?;
        // ステップ完了を通知する
        reporter.step_done("baget_dirs", step_t.elapsed().as_millis() as u64);

        // ステップ 1: BaGet をダウンロードして展開する
        let step_t = Instant::now();
        reporter.step_start("baget_fetch", "BaGet をダウンロードしています", 6, 1);

        // DEVPORTAL_BAGET_PATH 環境変数が設定されている場合はそれを使用する
        if let Ok(local_path) = std::env::var("DEVPORTAL_BAGET_PATH") {
            // 環境変数で指定されたパスを PathBuf に変換する
            let local_zip = PathBuf::from(&local_path);
            // ローカル ZIP ファイルの存在を確認する
            if !local_zip.exists() {
                // 指定されたファイルが存在しない場合はエラーを返す
                return Err(SetupError::Other(format!(
                    "DEVPORTAL_BAGET_PATH に指定されたファイルが見つかりません: {}",
                    local_path
                )));
            }
            // ローカル ZIP を baget_app_dir に展開する
            Self::extract_zip(&local_zip, &baget_app_dir)?;
        } else {
            // URL を組み立てる
            let url = BAGET_DOWNLOAD_URL_TEMPLATE.replace("{version}", &config.baget.version);

            // 一時ファイルのパスを生成する（%TEMP%\devportal-baget-<timestamp>.zip）
            let tmp_zip = std::env::temp_dir().join(format!(
                "devportal-baget-{}.zip",
                // ランダムな識別子として現在時刻のナノ秒を使用する
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));

            // BaGet ZIP をダウンロードして一時ファイルに保存する
            Self::download_zip(reporter, &url, &tmp_zip)?;

            // 一時 ZIP を baget_app_dir に展開する
            Self::extract_zip(&tmp_zip, &baget_app_dir)?;

            // 一時 ZIP ファイルを削除する（失敗してもエラーにしない）
            let _ = fs::remove_file(&tmp_zip);
        }
        // ステップ完了を通知する
        reporter.step_done("baget_fetch", step_t.elapsed().as_millis() as u64);

        // ステップ 2: appsettings.json と runtimeconfig.json を生成・パッチする
        let step_t = Instant::now();
        reporter.step_start("baget_config", "BaGet 設定ファイルを生成しています", 6, 2);

        // packages_dir のパス文字列を取得する（Windows \ を / に変換する）
        let packages_dir_str = baget_packages_dir
            .to_string_lossy()
            // Windows のバックスラッシュをスラッシュに変換する（JSON 内での互換性のため）
            .replace('\\', "/");

        // data_dir のパス文字列を取得する（Windows \ を / に変換する）
        let data_dir_str = baget_data_dir
            .to_string_lossy()
            // Windows のバックスラッシュをスラッシュに変換する
            .replace('\\', "/");

        // appsettings.json の内容を生成する（テンプレートのプレースホルダを置換する）
        let appsettings_content = BAGET_APPSETTINGS_TEMPLATE
            // packages_dir プレースホルダを実際のパスに置換する
            .replace("{packages_dir}", &packages_dir_str)
            // db_dir プレースホルダを実際のパスに置換する
            .replace("{db_dir}", &data_dir_str)
            // port プレースホルダを実際のポート番号に置換する
            .replace("{port}", &config.baget.port.to_string());

        // appsettings.json のパスを構築する（BaGet.dll と同じディレクトリ）
        let appsettings_path = baget_app_dir.join("appsettings.json");
        // appsettings.json を書き込む
        fs::write(&appsettings_path, &appsettings_content)?;

        // BaGet.runtimeconfig.json に rollForward: Major を追加して .NET 8+ で動作させる
        // BaGet 0.4.0-preview2 は .NET Core 3.1 ターゲットだが、インストール済みの .NET 8+ で起動できる
        Self::patch_runtimeconfig(&baget_app_dir)?;

        // dotnet.exe のフルパスを解決する（サービス登録で使用するため事前に取得する）
        let dotnet_exe = Self::find_dotnet_exe()?;
        // dotnet.exe のパス文字列を取得する
        let dotnet_exe_str = dotnet_exe.to_string_lossy().to_string();

        // ステップ完了を通知する
        reporter.step_done("baget_config", step_t.elapsed().as_millis() as u64);

        // ステップ 3: NSSM を確保してサービスを登録する
        // Nssm::ensure はキャッシュ確認 → 必要なら自動ダウンロードを行い step_start/step_done を送出する
        let nssm = Nssm::ensure(reporter)?;

        // ステップ 4: NSSM サービス登録
        let step_t = Instant::now();
        reporter.step_start("nssm_install", "NSSM サービス登録", 6, 3);

        // BaGet.dll のフルパスを構築する（dotnet コマンドの引数として渡す）
        // BaGet 0.4.0-preview2 はフレームワーク依存デプロイメントのため BaGet.exe は存在しない
        let baget_dll = baget_app_dir.join("BaGet.dll");
        // BaGet.dll のパス文字列を取得する
        let baget_dll_str = baget_dll.to_string_lossy().to_string();

        // nssm install でサービスを dotnet.exe として登録する
        nssm.install(&service_name, &dotnet_exe_str, reporter)?;

        // 作業ディレクトリのパス文字列を取得する
        let baget_app_dir_str = baget_app_dir.to_string_lossy().to_string();
        // stdout ログファイルのパスを構築する
        let stdout_log = baget_logs_dir.join("baget-stdout.log");
        // stderr ログファイルのパスを構築する
        let stderr_log = baget_logs_dir.join("baget-stderr.log");
        // stdout ログパスの文字列を取得する
        let stdout_log_str = stdout_log.to_string_lossy().to_string();
        // stderr ログパスの文字列を取得する
        let stderr_log_str = stderr_log.to_string_lossy().to_string();

        // サービスの詳細設定を一括で行う
        nssm.configure_service(
            // サービス名を指定する
            &service_name,
            // 表示名を指定する
            "DevPortal - BaGet NuGet Registry",
            // 説明文を指定する
            "DevPortal が管理するプライベート NuGet レジストリ (BaGet)",
            // 作業ディレクトリを指定する
            &baget_app_dir_str,
            // 標準出力ログファイルを指定する
            &stdout_log_str,
            // 標準エラーログファイルを指定する
            &stderr_log_str,
            // 追加環境変数（ASPNETCORE_ENVIRONMENT を Production に設定する）
            &[("ASPNETCORE_ENVIRONMENT", "Production")],
        )?;

        // AppParameters に BaGet.dll のパスを設定する（dotnet の引数として渡す）
        // nssm は Application=dotnet.exe、AppParameters=BaGet.dll として起動する
        nssm.set(&service_name, "AppParameters", &baget_dll_str)?;

        // ステップ完了を通知する
        reporter.step_done("nssm_install", step_t.elapsed().as_millis() as u64);

        // ステップ 5: サービスを起動する
        let step_t = Instant::now();
        reporter.step_start("service_start", "サービスを起動しています", 6, 4);
        // nssm start でサービスを起動する
        nssm.start(&service_name)?;
        // ステップ完了を通知する
        reporter.step_done("service_start", step_t.elapsed().as_millis() as u64);

        // ステップ 6: ヘルスチェック
        let step_t = Instant::now();
        reporter.step_start("health_check", "ヘルスチェック待機中", 6, 5);
        // TCP 接続で BaGet が応答するまで待機する（最大 30 秒・1 秒ごとにリトライ）
        let reachable = Self::wait_for_tcp("127.0.0.1", config.baget.port, 30, 1);
        // ヘルスチェック結果をログに記録する
        if reachable {
            // 接続成功をログに記録する
            reporter.info(format!(
                "BaGet がポート {} で応答しています",
                config.baget.port
            ));
        } else {
            // 接続失敗を警告としてログに記録する（サービス起動は成功しているため続行）
            reporter.warn(
                None,
                format!(
                    "BaGet のヘルスチェックがタイムアウトしました（ポート {}）",
                    config.baget.port
                ),
            );
        }
        // ステップ完了を通知する
        reporter.step_done("health_check", step_t.elapsed().as_millis() as u64);

        // インストール完了イベントを送信する
        reporter.finished(
            // BaGet コンポーネントの完了を通知する
            Component::BaGet,
            // インストール操作の完了を通知する
            ActionKind::Install,
            // 完了の要約テキストを生成する
            format!(
                "BaGet を Windows サービス '{}' としてインストールしました（ポート {}）",
                service_name, config.baget.port
            ),
        );

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // BaGet をアンインストールする
    fn uninstall(
        &self,
        config: &SetupConfig,
        reporter: &Reporter,
        keep_data: bool,
    ) -> Result<(), SetupError> {
        // サービス名を取得する
        let service_name = self.service_name(config);
        // NSSM を確保する（キャッシュがあれば即時、なければ HTTP 動的取得）
        let nssm = Nssm::ensure(reporter)?;

        // サービスを停止する（失敗しても続行する）
        reporter.info("BaGet サービスを停止しています...");
        // stop の失敗は無視する（既に停止済みの可能性があるため）
        let _ = nssm.stop(&service_name);

        // サービスを削除する
        reporter.info("BaGet サービスを削除しています...");
        // サービス削除に失敗した場合はエラーを返す
        nssm.remove(&service_name)?;

        // データ保持フラグに応じてディレクトリを削除する
        if keep_data {
            // keep_data = true のとき baget_app_dir のみ削除してデータは保持する
            reporter.info("BaGet app ディレクトリを削除しています（packages / data は保持）...");
            // app ディレクトリのみ削除する
            let app_dir = paths::baget_app_dir(config);
            // app_dir が存在する場合のみ削除する
            if app_dir.exists() {
                // app ディレクトリを再帰的に削除する
                fs::remove_dir_all(&app_dir)?;
            }
        } else {
            // keep_data = false のとき baget_dir 全体を削除する
            reporter.info("BaGet データディレクトリを全て削除しています...");
            // baget のルートディレクトリを取得する
            let baget_dir = paths::baget_dir(config);
            // ディレクトリが存在する場合のみ削除する
            if baget_dir.exists() {
                // baget ディレクトリ全体を再帰的に削除する
                fs::remove_dir_all(&baget_dir)?;
            }
        }

        // アンインストール完了イベントを送信する
        reporter.finished(
            // BaGet コンポーネントの完了を通知する
            Component::BaGet,
            // アンインストール操作の完了を通知する
            ActionKind::Uninstall,
            // 完了の要約テキストを生成する
            format!(
                "BaGet サービス '{}' のアンインストールが完了しました",
                service_name
            ),
        );

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // BaGet の現在の状態を返す
    fn status(&self, config: &SetupConfig) -> Result<ComponentStatus, SetupError> {
        // サービス名を取得する
        let service_name = self.service_name(config);
        // NSSM を使ってサービスの状態を取得する
        let nssm_result = Nssm::from_env();
        // サービスの状態を取得する
        let service_status = match nssm_result {
            // NSSM が利用可能な場合はサービス状態を取得する
            Ok(nssm) => nssm.status(&service_name),
            // NSSM が利用できない場合は winsvc を直接使用する
            Err(_) => crate::winsvc::query_service_status(&service_name),
        };

        // ポート番号を取得する
        let port = config.baget.port;
        // 未インストール時は TCP プローブをスキップする（最大 2 秒の無駄な待ちを防ぐ）
        let endpoint_reachable = if service_status == crate::winsvc::ServiceStatus::NotInstalled {
            // サービスが存在しない場合はエンドポイントに到達できないと確定する
            false
        } else {
            // TCP 接続でエンドポイントの生死確認を行う
            TcpStream::connect_timeout(
                // 接続先アドレスを構築する
                &format!("127.0.0.1:{}", port)
                    .parse()
                    .unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap()),
                // タイムアウトを 2 秒に設定する
                Duration::from_secs(2),
            )
            .is_ok()
        };

        // エンドポイント URL を構築する（BaGet の NuGet v3 API エンドポイント）
        let endpoint_url = format!("http://127.0.0.1:{}/v3/index.json", port);
        // ブラウザで開く Web UI ルート URL を構築する
        let web_url = format!("http://127.0.0.1:{}/", port);
        // パッケージストレージディレクトリの存在確認を行う
        let data_dir_exists = paths::baget_packages_dir(config).exists();

        // ComponentStatus を構築して返す
        Ok(ComponentStatus {
            // BaGet コンポーネントを指定する
            component: Component::BaGet,
            // サービス名を格納する
            service_name,
            // サービスの状態を格納する
            service_status,
            // エンドポイント到達可否を格納する
            endpoint_reachable,
            // エンドポイント URL を格納する
            endpoint_url,
            // Web UI ルート URL を格納する
            web_url,
            // データディレクトリの存在確認結果を格納する
            data_dir_exists,
        })
    }
}
