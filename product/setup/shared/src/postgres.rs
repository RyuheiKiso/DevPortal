// このファイルは PostgreSQL（EDB バイナリ ZIP）の SetupEngine 実装を定義する
// BaGet 実装（baget.rs）をテンプレートとし、ZIP DL → 展開 → initdb → NSSM 登録の流れを実現する

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

// ファイルシステムパスを扱うために PathBuf と Path をインポートする
use std::path::{Path, PathBuf};

// ランダムパスワード生成に使用するトレイトをインポートする
use rand::Rng;

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

// EDB の Windows バイナリ ZIP の URL テンプレート（{version} を PostgresConfig.version で置換）
const POSTGRES_DOWNLOAD_URL_TEMPLATE: &str =
    "https://get.enterprisedb.com/postgresql/postgresql-{version}-windows-x64-binaries.zip";

// ダウンロード時のバッファサイズ（8KB）
const DOWNLOAD_BUF_SIZE: usize = 8 * 1024;

// パスワード生成に使用する文字セット（英大文字・英小文字・数字・記号）
const PASSWORD_CHARS: &[u8] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

// PostgresEngine: PostgreSQL の SetupEngine 実装構造体
// フィールドを持たないユニット構造体として定義する
pub struct PostgresEngine;

// PostgresEngine のプライベートヘルパーメソッド実装ブロック
impl PostgresEngine {
    // ランダムな 24 文字のパスワードを生成する（英大小文字・数字・記号）
    pub fn generate_password() -> String {
        // スレッドローカルの乱数生成器を取得する
        let mut rng = rand::thread_rng();
        // 24 文字分のランダムなインデックスを生成して文字を選択する
        (0..24)
            .map(|_| {
                // 文字セットのランダムなインデックスを取得する
                let idx = rng.gen_range(0..PASSWORD_CHARS.len());
                // インデックスに対応する文字を ASCII 文字として返す
                PASSWORD_CHARS[idx] as char
            })
            // 文字のイテレータを String に変換する
            .collect()
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

    // PostgreSQL の ZIP ファイルを HTTP でダウンロードして保存するヘルパーメソッド
    // reporter: 進捗を通知するための Reporter への参照
    // url: ダウンロード URL
    // dest: 保存先ファイルパス
    fn download_zip(reporter: &Reporter, url: &str, dest: &Path) -> Result<(), SetupError> {
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
                    "PostgreSQL のダウンロードに失敗しました: {e}\n\
                    ・社内プロキシ環境では HTTPS_PROXY 環境変数を設定してください\n\
                    ・オフライン環境では DEVPORTAL_POSTGRES_PATH 環境変数で ZIP のパスを指定してください"
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
                    reporter.progress("pg_fetch", dl_percent, None);
                }
            }
        }

        // ファイルのフラッシュを確実に行う
        out_file.flush().map_err(SetupError::Io)?;

        // 正常終了を返す
        Ok(())
    }

    // ZIP ファイルを展開し、ルートの "pgsql/" ディレクトリを app_dir 直下へ flatten するヘルパーメソッド
    // EDB の ZIP は "pgsql/" をルートに持つため、flatten して app_dir 直下に bin/ 等を配置する
    fn extract_and_flatten(zip_path: &Path, app_dir: &Path) -> Result<(), SetupError> {
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

            // EDB ZIP のルートプレフィックス "pgsql/" を取り除いて flatten する
            // "pgsql/bin/postgres.exe" → "bin/postgres.exe" のように変換する
            let stripped = entry_name
                .strip_prefix("pgsql/")
                .or_else(|| entry_name.strip_prefix("pgsql\\"))
                .unwrap_or(&entry_name);

            // 空文字（"pgsql/" ルートエントリ自体）はスキップする
            if stripped.is_empty() {
                // ルートディレクトリエントリはスキップする
                continue;
            }

            // 展開先のフルパスを構築する（app_dir 直下に flatten する）
            let out_path = app_dir.join(stripped);

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

    // initdb を実行して PostgreSQL クラスターを初期化するヘルパーメソッド
    // 一時パスワードファイルを作成し、initdb 終了後に必ず削除する
    fn run_initdb(
        // initdb.exe のフルパス
        initdb_exe: &Path,
        // クラスターデータを作成するディレクトリ
        data_dir: &Path,
        // postgres スーパーユーザーの初期パスワード
        password: &str,
        // 進捗を通知するための Reporter
        reporter: &Reporter,
    ) -> Result<(), SetupError> {
        // 一時パスワードファイルのパスを生成する（%TEMP%\devportal-pg-pw-<timestamp>.txt）
        let tmp_pwfile = std::env::temp_dir().join(format!(
            "devportal-pg-pw-{}.txt",
            // ランダムな識別子として現在時刻のナノ秒を使用する
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));

        // パスワードを一時ファイルに書き込む（initdb は改行を含む pwfile を期待する）
        fs::write(&tmp_pwfile, format!("{}\n", password)).map_err(|e| {
            SetupError::Other(format!("一時パスワードファイルの作成に失敗しました: {e}"))
        })?;

        // initdb を実行する（失敗しても必ず一時ファイルを削除する）
        let result = (|| -> Result<(), SetupError> {
            // initdb コマンドを組み立てる
            let output = std::process::Command::new(initdb_exe)
                // データディレクトリを指定する
                .arg("-D")
                .arg(data_dir)
                // スーパーユーザー名を postgres に固定する
                .arg("-U")
                .arg("postgres")
                // パスワードファイルを指定する（--pwfile は initdb に渡す）
                .arg("--pwfile")
                .arg(&tmp_pwfile)
                // データベースのエンコーディングを UTF-8 に設定する
                .arg("-E")
                .arg("UTF8")
                // ロケールを C に設定する（文字列比較の一貫性を確保する）
                .arg("--locale=C")
                // 標準出力をキャプチャする
                .stdout(std::process::Stdio::piped())
                // 標準エラーをキャプチャする
                .stderr(std::process::Stdio::piped())
                // initdb を実行して完了を待つ
                .output()
                .map_err(|e| SetupError::Other(format!("initdb の実行に失敗しました: {e}")))?;

            // initdb の標準出力を Reporter に転送する
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                // 各行を stdout イベントとして送信する
                reporter.stdout_line("pg_initdb", line);
            }

            // initdb の標準エラーを Reporter に転送する
            for line in String::from_utf8_lossy(&output.stderr).lines() {
                // 各行を stderr イベントとして送信する
                reporter.stderr_line("pg_initdb", line);
            }

            // initdb が失敗した場合はエラーを返す
            if !output.status.success() {
                // 終了コードをエラーメッセージに含める
                return Err(SetupError::Other(format!(
                    "initdb が失敗しました（終了コード: {:?}）",
                    output.status.code()
                )));
            }

            // 正常終了を返す
            Ok(())
        })();

        // 一時パスワードファイルを削除する（成功・失敗にかかわらず必ず削除する）
        let _ = fs::remove_file(&tmp_pwfile);

        // initdb の結果を返す
        result
    }

    // postgresql.conf の port と listen_addresses を書き換えるヘルパーメソッド
    // 既存の設定行をコメントアウトして新しい値を末尾に追記する方式を採用する
    fn patch_postgresql_conf(
        conf: &Path,
        port: u16,
        listen_addresses: &str,
    ) -> Result<(), SetupError> {
        // postgresql.conf をテキストとして読み込む
        let content = fs::read_to_string(conf).map_err(|e| {
            SetupError::Other(format!("postgresql.conf の読み込みに失敗しました: {e}"))
        })?;

        // 各行を処理して port と listen_addresses の設定行をコメントアウトする
        let patched: String = content
            .lines()
            .map(|line| {
                // trimmed で先頭の空白・コメント記号を無視して比較する
                let trimmed = line.trim_start_matches('#').trim();
                // port の設定行を検出してコメントアウトする
                if (trimmed.starts_with("port") || trimmed.starts_with("listen_addresses"))
                    && trimmed.contains('=')
                {
                    // 元の行をコメントアウトする
                    format!("#{}", line)
                } else {
                    // それ以外の行はそのまま返す
                    line.to_string()
                }
            })
            // 行を改行で結合する
            .collect::<Vec<_>>()
            .join("\n");

        // 末尾に新しい設定を追記する（DevPortal による自動設定であることをコメントで示す）
        let final_content = format!(
            "{}\n# DevPortal による自動設定\nlisten_addresses = '{}'\nport = {}\n",
            patched, listen_addresses, port
        );

        // 更新した内容を postgresql.conf に書き戻す
        fs::write(conf, final_content).map_err(|e| {
            SetupError::Other(format!("postgresql.conf の書き込みに失敗しました: {e}"))
        })?;

        // 正常終了を返す
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
}

// SetupEngine トレイトの PostgresEngine への実装
impl SetupEngine for PostgresEngine {
    // コンポーネント名を返す（ログ表示用）
    fn name(&self) -> &str {
        // PostgreSQL コンポーネントの表示名を返す
        "PostgreSQL"
    }

    // Windows サービスの識別名を返す
    // config.service_prefix と "Postgres" を連結した名前を使用する
    fn service_name(&self, config: &SetupConfig) -> String {
        // サービスプレフィックスと Postgres を連結してサービス名を生成する
        format!("{}-Postgres", config.service_prefix)
    }

    // PostgreSQL をインストールして Windows サービスとして登録する
    fn install(&self, config: &SetupConfig, reporter: &Reporter) -> Result<(), SetupError> {
        // サービス名を取得する
        let service_name = self.service_name(config);

        // ステップ 0: 必要なディレクトリを作成する
        let step_t = Instant::now();
        reporter.step_start("pg_dirs", "PostgreSQL ディレクトリを作成しています", 8, 0);

        // PostgreSQL のバイナリ展開先ディレクトリを取得する
        let pg_app_dir = paths::postgres_app_dir(config);
        // PostgreSQL のデータディレクトリを取得する
        let pg_data_dir = paths::postgres_data_dir(config);
        // PostgreSQL のログ出力ディレクトリを取得する
        let pg_logs_dir = paths::postgres_logs_dir(config);

        // バイナリ展開先ディレクトリを再帰的に作成する
        fs::create_dir_all(&pg_app_dir)?;
        // ログ出力ディレクトリを再帰的に作成する
        fs::create_dir_all(&pg_logs_dir)?;
        // ステップ完了を通知する
        reporter.step_done("pg_dirs", step_t.elapsed().as_millis() as u64);

        // ステップ 1: EDB バイナリ ZIP をダウンロードして展開する
        let step_t = Instant::now();
        reporter.step_start("pg_fetch", "PostgreSQL をダウンロードしています", 8, 1);

        // DEVPORTAL_POSTGRES_PATH 環境変数が設定されている場合はそれを使用する（オフラインフォールバック）
        if let Ok(local_path) = std::env::var("DEVPORTAL_POSTGRES_PATH") {
            // 環境変数で指定されたパスを PathBuf に変換する
            let local_zip = PathBuf::from(&local_path);
            // ローカル ZIP ファイルの存在を確認する
            if !local_zip.exists() {
                // 指定されたファイルが存在しない場合はエラーを返す
                return Err(SetupError::Other(format!(
                    "DEVPORTAL_POSTGRES_PATH に指定されたファイルが見つかりません: {}",
                    local_path
                )));
            }
            // ローカル ZIP を pg_app_dir に展開する（pgsql/ を flatten する）
            Self::extract_and_flatten(&local_zip, &pg_app_dir)?;
        } else {
            // URL を組み立てる（{version} を設定値で置換する）
            let url = POSTGRES_DOWNLOAD_URL_TEMPLATE.replace("{version}", &config.postgres.version);

            // 一時ファイルのパスを生成する（%TEMP%\devportal-postgres-<timestamp>.zip）
            let tmp_zip = std::env::temp_dir().join(format!(
                "devportal-postgres-{}.zip",
                // ランダムな識別子として現在時刻のナノ秒を使用する
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));

            // PostgreSQL ZIP をダウンロードして一時ファイルに保存する
            Self::download_zip(reporter, &url, &tmp_zip)?;

            // 一時 ZIP を pg_app_dir に展開する（pgsql/ を flatten する）
            Self::extract_and_flatten(&tmp_zip, &pg_app_dir)?;

            // 一時 ZIP ファイルを削除する（失敗してもエラーにしない）
            let _ = fs::remove_file(&tmp_zip);
        }
        // ステップ完了を通知する
        reporter.step_done("pg_fetch", step_t.elapsed().as_millis() as u64);

        // ステップ 2: パスワードを確認・確定する
        let step_t = Instant::now();
        reporter.step_start("pg_password", "パスワードを設定しています", 8, 2);

        // 設定のパスワードが空の場合は新しいパスワードを生成する
        let password = if config.postgres.superuser_password.is_empty() {
            // ランダムなパスワードを生成する
            Self::generate_password()
        } else {
            // 設定済みのパスワードをそのまま使用する
            config.postgres.superuser_password.clone()
        };
        // ステップ完了を通知する
        reporter.step_done("pg_password", step_t.elapsed().as_millis() as u64);

        // ステップ 3: initdb でクラスターを初期化する
        let step_t = Instant::now();
        reporter.step_start(
            "pg_initdb",
            "データベースクラスターを初期化しています",
            8,
            3,
        );

        // initdb を実行する前にデータディレクトリを一旦クリアして冪等性を保つ
        if pg_data_dir.exists() {
            // 既存のデータディレクトリを削除する（再初期化のため）
            fs::remove_dir_all(&pg_data_dir).map_err(|e| {
                SetupError::Other(format!("データディレクトリのクリアに失敗しました: {e}"))
            })?;
        }
        // データディレクトリを再作成する
        fs::create_dir_all(&pg_data_dir)?;

        // initdb.exe のフルパスを構築する
        let initdb_exe = pg_app_dir.join("bin").join("initdb.exe");
        // initdb.exe の存在を確認する
        if !initdb_exe.exists() {
            // initdb.exe が見つからない場合はエラーを返す
            return Err(SetupError::Other(format!(
                "initdb.exe が見つかりません: {}",
                initdb_exe.display()
            )));
        }

        // initdb でクラスターを初期化する（一時 pwfile を内部で作成・削除する）
        Self::run_initdb(&initdb_exe, &pg_data_dir, &password, reporter)?;
        // ステップ完了を通知する
        reporter.step_done("pg_initdb", step_t.elapsed().as_millis() as u64);

        // ステップ 4: postgresql.conf を編集してポートと listen_addresses を設定する
        let step_t = Instant::now();
        reporter.step_start("pg_config", "postgresql.conf を編集しています", 8, 4);

        // postgresql.conf のパスを取得する
        let pg_conf = paths::postgres_conf_file(config);
        // postgresql.conf の存在を確認する
        if !pg_conf.exists() {
            // initdb が生成するはずの postgresql.conf がない場合はエラーを返す
            return Err(SetupError::Other(format!(
                "postgresql.conf が見つかりません: {}（initdb が正常に完了しなかった可能性があります）",
                pg_conf.display()
            )));
        }

        // postgresql.conf に port と listen_addresses を設定する
        Self::patch_postgresql_conf(
            &pg_conf,
            config.postgres.port,
            &config.postgres.listen_addresses,
        )?;
        // ステップ完了を通知する
        reporter.step_done("pg_config", step_t.elapsed().as_millis() as u64);

        // ステップ 5: NSSM を確保してサービスを登録する
        // Nssm::ensure はキャッシュ確認 → 必要なら自動ダウンロードを行い step_start/step_done を送出する
        let nssm = Nssm::ensure(reporter)?;

        // ステップ 6: NSSM サービス登録
        let step_t = Instant::now();
        reporter.step_start("nssm_install", "NSSM サービス登録", 8, 5);

        // postgres.exe のフルパスを構築する
        let postgres_exe = pg_app_dir.join("bin").join("postgres.exe");
        // postgres.exe のパス文字列を取得する
        let postgres_exe_str = postgres_exe.to_string_lossy().to_string();
        // データディレクトリのパス文字列を取得する（AppParameters の -D に使用する）
        let pg_data_dir_str = pg_data_dir.to_string_lossy().to_string();
        // postgres.exe のインストール先ディレクトリ（bin/ の親）のパス文字列を取得する
        // 作業ディレクトリはアプリのインストール先にする（data_dir にすると postgres.exe がカレントに log/tmp を撒く）
        let pg_app_dir_str = pg_app_dir.to_string_lossy().to_string();
        // nssm install でサービスを postgres.exe として登録する
        nssm.install(&service_name, &postgres_exe_str, reporter)?;

        // stdout ログファイルのパスを構築する
        let stdout_log = pg_logs_dir.join("postgres-stdout.log");
        // stderr ログファイルのパスを構築する
        let stderr_log = pg_logs_dir.join("postgres-stderr.log");
        // stdout ログパスの文字列を取得する
        let stdout_log_str = stdout_log.to_string_lossy().to_string();
        // stderr ログパスの文字列を取得する
        let stderr_log_str = stderr_log.to_string_lossy().to_string();

        // サービスの詳細設定を一括で行う
        nssm.configure_service(
            // サービス名を指定する
            &service_name,
            // 表示名を指定する
            "DevPortal - PostgreSQL Database",
            // 説明文を指定する
            "DevPortal が管理するリレーショナルデータベース (PostgreSQL)",
            // 作業ディレクトリは postgres.exe のインストール先（pg_app_dir）に指定する
            &pg_app_dir_str,
            // 標準出力ログファイルを指定する
            &stdout_log_str,
            // 標準エラーログファイルを指定する
            &stderr_log_str,
            // 追加の環境変数は不要（データディレクトリは -D コマンドラインで明示的に指定する）
            &[],
        )?;

        // AppParameters に "-D <data_dir>" を設定する（postgres.exe に直接渡す）
        // -D だけに統一することで PGDATA との二重指定による混乱を回避する
        nssm.set(
            &service_name,
            "AppParameters",
            &format!("-D \"{}\"", pg_data_dir_str),
        )?;

        // ステップ完了を通知する
        reporter.step_done("nssm_install", step_t.elapsed().as_millis() as u64);

        // ステップ 7: サービスを起動する
        let step_t = Instant::now();
        reporter.step_start("service_start", "サービスを起動しています", 8, 6);
        // nssm start でサービスを起動する
        nssm.start(&service_name)?;
        // ステップ完了を通知する
        reporter.step_done("service_start", step_t.elapsed().as_millis() as u64);

        // ステップ 8: ヘルスチェック
        let step_t = Instant::now();
        reporter.step_start("health_check", "ヘルスチェック待機中", 8, 7);
        // TCP 接続で PostgreSQL が応答するまで待機する（最大 30 秒・1 秒ごとにリトライ）
        let reachable = Self::wait_for_tcp("127.0.0.1", config.postgres.port, 30, 1);
        // ヘルスチェック結果をログに記録する
        if reachable {
            // 接続成功をログに記録する
            reporter.info(format!(
                "PostgreSQL がポート {} で応答しています",
                config.postgres.port
            ));
        } else {
            // 接続失敗を警告としてログに記録する（サービス起動は成功しているため続行）
            reporter.warn(
                None,
                format!(
                    "PostgreSQL のヘルスチェックがタイムアウトしました（ポート {}）",
                    config.postgres.port
                ),
            );
        }
        // ステップ完了を通知する
        reporter.step_done("health_check", step_t.elapsed().as_millis() as u64);

        // インストール完了イベントを送信する
        reporter.finished(
            // PostgreSQL コンポーネントの完了を通知する
            Component::Postgres,
            // インストール操作の完了を通知する
            ActionKind::Install,
            // 完了の要約テキストを生成する
            format!(
                "PostgreSQL を Windows サービス '{}' としてインストールしました（ポート {}）",
                service_name, config.postgres.port
            ),
        );

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // PostgreSQL をアンインストールする
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
        reporter.info("PostgreSQL サービスを停止しています...");
        // stop の失敗は無視する（既に停止済みの可能性があるため）
        let _ = nssm.stop(&service_name);

        // サービスを削除する
        reporter.info("PostgreSQL サービスを削除しています...");
        // サービス削除に失敗した場合はエラーを返す
        nssm.remove(&service_name)?;

        // データ保持フラグに応じてディレクトリを削除する
        if keep_data {
            // keep_data = true のとき pg_app_dir のみ削除してデータは保持する
            reporter.info("PostgreSQL app ディレクトリを削除しています（data は保持）...");
            // app ディレクトリのみ削除する
            let app_dir = paths::postgres_app_dir(config);
            // app_dir が存在する場合のみ削除する
            if app_dir.exists() {
                // app ディレクトリを再帰的に削除する
                fs::remove_dir_all(&app_dir)?;
            }
        } else {
            // keep_data = false のとき postgres_dir 全体を削除する
            reporter.info("PostgreSQL データディレクトリを全て削除しています...");
            // postgres のルートディレクトリを取得する
            let pg_dir = paths::postgres_dir(config);
            // ディレクトリが存在する場合のみ削除する
            if pg_dir.exists() {
                // postgres ディレクトリ全体を再帰的に削除する
                fs::remove_dir_all(&pg_dir)?;
            }
        }

        // アンインストール完了イベントを送信する
        reporter.finished(
            // PostgreSQL コンポーネントの完了を通知する
            Component::Postgres,
            // アンインストール操作の完了を通知する
            ActionKind::Uninstall,
            // 完了の要約テキストを生成する
            format!(
                "PostgreSQL サービス '{}' のアンインストールが完了しました",
                service_name
            ),
        );

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // PostgreSQL の現在の状態を返す
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
        let port = config.postgres.port;
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

        // エンドポイント URL を構築する（PostgreSQL の接続文字列形式で表示する）
        let endpoint_url = format!("postgres://postgres@127.0.0.1:{}/postgres", port);
        // ブラウザ URL は PostgreSQL に Web UI がないため postgres:// 形式で統一する
        let web_url = format!("postgres://postgres@127.0.0.1:{}/postgres", port);
        // データディレクトリの存在確認を行う
        let data_dir_exists = paths::postgres_data_dir(config).exists();

        // ComponentStatus を構築して返す
        Ok(ComponentStatus {
            // PostgreSQL コンポーネントを指定する
            component: Component::Postgres,
            // サービス名を格納する
            service_name,
            // サービスの状態を格納する
            service_status,
            // エンドポイント到達可否を格納する
            endpoint_reachable,
            // エンドポイント URL を格納する
            endpoint_url,
            // Web URL を格納する（PostgreSQL は Web UI がないため接続文字列を流用する）
            web_url,
            // データディレクトリの存在確認結果を格納する
            data_dir_exists,
        })
    }
}
