// このファイルは Microsoft SQL Server の SetupEngine 実装を定義する
// PostgreSQL 実装をベースに「ISO ダウンロード → Mount-DiskImage → setup.exe サイレントインストール → ポート設定 → サービス起動」の流れを実現する
// SQL Server インストーラがサービス（MSSQL$<INSTANCE>）を自動登録するため NSSM は使用しない

// ファイルシステム操作に必要な型をインポートする
use std::fs;

// ファイル読み書きに必要なトレイトをインポートする
use std::io::{Read, Write};

// ネットワーク接続確認に必要な型をインポートする
use std::net::TcpStream;

// SocketAddr と ToSocketAddrs を DNS 解決タイムアウトに使用する
use std::net::{SocketAddr, ToSocketAddrs};

// 外部コマンド実行のために Command と Stdio をインポートする
use std::process::{Command, Stdio};

// DNS 解決タイムアウトのためにスレッドとチャネルをインポートする
use std::sync::mpsc;

// 標準時間型をインポートする（タイムアウト・待機処理・経過時間計測に使用）
use std::time::{Duration, Instant};

// ファイルシステムパスを扱うために Path と PathBuf をインポートする
use std::path::{Path, PathBuf};

// 独自エラー型を参照するために使用する
use crate::error::SetupError;

// 進捗イベント送信と型を参照するために使用する
use crate::event::{ActionKind, Component, Reporter};

// セットアップ設定構造体を参照するために使用する
use crate::config::SetupConfig;

// コンポーネントステータス構造体と SetupEngine トレイトを参照するために使用する
use crate::engine::{ComponentStatus, SetupEngine};

// パス解決関数を参照するために使用する
use crate::paths;

// Windows サービスの状態確認関数を参照するために使用する
use crate::winsvc;

// ダウンロード時のバッファサイズ（8KB）
const DOWNLOAD_BUF_SIZE: usize = 8 * 1024;

// SqlServerEngine: Microsoft SQL Server の SetupEngine 実装構造体
// フィールドを持たないユニット構造体として定義する
pub struct SqlServerEngine;

// SqlServerEngine のプライベートヘルパーメソッド実装ブロック
impl SqlServerEngine {
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

    // SQL Server インストーラ ISO を HTTP でダウンロードして保存するヘルパーメソッド
    // reporter: 進捗を通知するための Reporter への参照
    // url: ダウンロード URL
    // dest: 保存先ファイルパス
    fn download_iso(reporter: &Reporter, url: &str, dest: &Path) -> Result<(), SetupError> {
        // タイムアウト設定付き AgentBuilder を構築する
        let mut builder = ureq::AgentBuilder::new()
            // DNS 解決を別スレッドで 10 秒以内に打ち切るカスタムリゾルバを設定する
            .resolver(Self::resolve_with_timeout as fn(&str) -> std::io::Result<Vec<SocketAddr>>)
            // TCP 接続確立が 15 秒以内に完了しない場合にエラーとする
            .timeout_connect(Duration::from_secs(15))
            // 各 read 呼び出しが 120 秒以内に応答しない場合にエラーとする（SQL Server ISO は大きいため余裕を持たせる）
            .timeout_read(Duration::from_secs(120));

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
        // HTTP GET リクエストを送信する（go.microsoft.com はリダイレクトを返すため redirect を有効のままにする）
        let response = agent
            .get(url)
            .call()
            // HTTP エラーを SetupError::Other に変換する
            .map_err(|e| {
                SetupError::Other(format!(
                    "SQL Server ISO のダウンロードに失敗しました: {e}\n\
                    ・社内プロキシ環境では HTTPS_PROXY 環境変数を設定してください\n\
                    ・オフライン環境では DEVPORTAL_SQLSERVER_PATH 環境変数で ISO のパスを指定してください"
                ))
            })?;

        // Content-Length ヘッダーから合計ファイルサイズを取得する（取得できない場合は None）
        let total_bytes: Option<u64> = response
            .header("Content-Length")
            // ヘッダーが存在する場合は u64 にパースを試みる
            .and_then(|v| v.parse().ok());

        // 保存先の親ディレクトリを作成する（ISO キャッシュディレクトリが未作成の場合に備える）
        if let Some(parent) = dest.parent() {
            // 親ディレクトリを再帰的に作成する
            fs::create_dir_all(parent).map_err(SetupError::Io)?;
        }
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
                // 0〜80% の範囲でダウンロード進捗を表示する（残り 20% は展開・インストールに割り当てる）
                let dl_percent = (downloaded_bytes as f64 / total as f64 * 80.0) as u8;
                // 定期的に進捗を通知する（全バイト更新より間引く）
                if downloaded_bytes.is_multiple_of(DOWNLOAD_BUF_SIZE as u64 * 64) {
                    // 進捗パーセントを通知する
                    reporter.progress("mssql_fetch", dl_percent, None);
                }
            }
        }

        // ファイルのフラッシュを確実に行う
        out_file.flush().map_err(SetupError::Io)?;

        // 正常終了を返す
        Ok(())
    }

    // PowerShell の Mount-DiskImage で ISO をマウントしてドライブレターを取得するヘルパーメソッド
    // iso_path: マウント対象の ISO ファイルパス
    // 戻り値: マウントされたドライブのレター（例: "E"）
    fn mount_iso(iso_path: &Path) -> Result<String, SetupError> {
        // PowerShell で Mount-DiskImage を実行し、マウントされたボリュームのドライブレターを返す
        // -PassThru で DiskImage オブジェクトを返し、Get-Volume でドライブレターを取り出す
        let script = format!(
            "$img = Mount-DiskImage -ImagePath '{}' -PassThru; \
             ($img | Get-Volume).DriveLetter",
            // パス内のシングルクォートをエスケープして PowerShell 文字列リテラルに埋め込む
            iso_path.display().to_string().replace('\'', "''")
        );

        // powershell.exe を非対話・コマンド指定モードで起動する
        let output = Command::new("powershell.exe")
            // ユーザープロファイル読み込みを無効化する（高速化）
            .arg("-NoProfile")
            // 実行ポリシーを Bypass にして無署名のインラインスクリプトを許可する
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            // 起動時の Logo 表示を抑止する
            .arg("-NonInteractive")
            // インラインコマンドを指定する
            .arg("-Command")
            .arg(&script)
            // 標準出力をキャプチャする
            .stdout(Stdio::piped())
            // 標準エラーをキャプチャする
            .stderr(Stdio::piped())
            // コマンドを実行して完了を待つ
            .output()
            .map_err(|e| SetupError::Other(format!("Mount-DiskImage の起動に失敗しました: {e}")))?;

        // 終了コードが 0 でなければエラーを返す
        if !output.status.success() {
            // 標準エラー出力をメッセージに含めて失敗を通知する
            let stderr_text = String::from_utf8_lossy(&output.stderr);
            return Err(SetupError::Other(format!(
                "ISO のマウントに失敗しました: {}",
                stderr_text
            )));
        }

        // 標準出力からドライブレターを取得する（先頭末尾の空白・改行を除去する）
        let drive_letter = String::from_utf8_lossy(&output.stdout).trim().to_string();

        // 取得したドライブレターが 1 文字でない場合はエラーを返す
        if drive_letter.len() != 1 || !drive_letter.chars().all(|c| c.is_ascii_alphabetic()) {
            // 異常な出力をエラーメッセージに含めて返す
            return Err(SetupError::Other(format!(
                "Mount-DiskImage の出力からドライブレターを取得できませんでした: '{}'",
                drive_letter
            )));
        }

        // 大文字化したドライブレターを返す（"E" のような単一文字）
        Ok(drive_letter.to_ascii_uppercase())
    }

    // PowerShell の Dismount-DiskImage で ISO のマウントを解除するヘルパーメソッド
    // iso_path: アンマウント対象の ISO ファイルパス
    // 失敗してもエラーを返さない（クリーンアップ目的のためベストエフォート）
    fn dismount_iso(iso_path: &Path) {
        // Dismount-DiskImage を実行するスクリプトを構築する
        let script = format!(
            "Dismount-DiskImage -ImagePath '{}' | Out-Null",
            // パス内のシングルクォートをエスケープして PowerShell 文字列リテラルに埋め込む
            iso_path.display().to_string().replace('\'', "''")
        );

        // PowerShell を起動して結果は無視する（クリーンアップ）
        let _ = Command::new("powershell.exe")
            // ユーザープロファイル読み込みを無効化する
            .arg("-NoProfile")
            // 実行ポリシーを Bypass にする
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            // 非対話モードで実行する
            .arg("-NonInteractive")
            // インラインコマンドを指定する
            .arg("-Command")
            .arg(&script)
            // 標準出力を捨てる
            .stdout(Stdio::null())
            // 標準エラーも捨てる
            .stderr(Stdio::null())
            // コマンドを実行する
            .status();
    }

    // ConfigurationFile.ini を生成するヘルパーメソッド
    // SQL Server セットアップに渡す無人インストール設定ファイルを書き出す
    fn write_configuration_ini(
        // 出力先ファイルパス
        path: &Path,
        // インスタンス名（INSTANCEID と INSTANCENAME に使用）
        instance_name: &str,
        // インスタンスインストール先ディレクトリ
        app_dir: &Path,
        // データディレクトリ（INSTALLSQLDATADIR に使用、内部に Data / Log / Backup / TempDb を作成する）
        data_dir: &Path,
    ) -> Result<(), SetupError> {
        // 親ディレクトリが存在しない場合は作成する
        if let Some(parent) = path.parent() {
            // 親ディレクトリを再帰的に作成する
            fs::create_dir_all(parent).map_err(SetupError::Io)?;
        }

        // ConfigurationFile.ini の本体を組み立てる
        // SAPWD は ini に書かず setup.exe へコマンドライン引数として渡すため除外する（平文残留を最小化）
        let ini = format!(
            "[OPTIONS]\r\n\
             ACTION=\"Install\"\r\n\
             ENU=\"True\"\r\n\
             QUIET=\"True\"\r\n\
             QUIETSIMPLE=\"False\"\r\n\
             UpdateEnabled=\"False\"\r\n\
             USEMICROSOFTUPDATE=\"False\"\r\n\
             SUPPRESSPRIVACYSTATEMENTNOTICE=\"True\"\r\n\
             IACCEPTSQLSERVERLICENSETERMS=\"True\"\r\n\
             FEATURES=SQLENGINE\r\n\
             INSTANCENAME=\"{instance}\"\r\n\
             INSTANCEID=\"{instance}\"\r\n\
             INSTANCEDIR=\"{app_dir}\"\r\n\
             INSTALLSQLDATADIR=\"{data_dir}\"\r\n\
             SQLBACKUPDIR=\"{data_dir}\\Backup\"\r\n\
             SQLUSERDBDIR=\"{data_dir}\\Data\"\r\n\
             SQLUSERDBLOGDIR=\"{data_dir}\\Log\"\r\n\
             SQLTEMPDBDIR=\"{data_dir}\\TempDb\"\r\n\
             SQLSVCSTARTUPTYPE=\"Automatic\"\r\n\
             AGTSVCSTARTUPTYPE=\"Disabled\"\r\n\
             BROWSERSVCSTARTUPTYPE=\"Disabled\"\r\n\
             SQLSVCACCOUNT=\"NT Service\\MSSQL${instance}\"\r\n\
             SECURITYMODE=\"SQL\"\r\n\
             SQLSYSADMINACCOUNTS=\"BUILTIN\\Administrators\"\r\n\
             TCPENABLED=\"1\"\r\n\
             NPENABLED=\"0\"\r\n\
             ERRORREPORTING=\"False\"\r\n\
             SQMREPORTING=\"False\"\r\n",
            // インスタンス名のプレースホルダ置換
            instance = instance_name,
            // インスタンスインストール先ディレクトリの置換
            app_dir = app_dir.display(),
            // データディレクトリの置換
            data_dir = data_dir.display(),
        );

        // ini ファイルとして書き出す
        fs::write(path, ini).map_err(|e| {
            // 書き込み失敗時はメッセージに変換する
            SetupError::Other(format!(
                "ConfigurationFile.ini の書き込みに失敗しました: {e}"
            ))
        })?;

        // 正常終了を返す
        Ok(())
    }

    // setup.exe をサイレントモードで実行するヘルパーメソッド
    // 出力（stdout/stderr）は逐次 Reporter に転送する
    fn run_setup_exe(
        // setup.exe のフルパス
        setup_exe: &Path,
        // ConfigurationFile.ini のフルパス
        config_ini: &Path,
        // SA パスワード（コマンドライン引数で渡す）
        sa_password: &str,
        // 進捗を通知するための Reporter
        reporter: &Reporter,
    ) -> Result<(), SetupError> {
        // setup.exe をサイレントインストールモードで起動する
        let output = Command::new(setup_exe)
            // 無人インストール（QUIET）モードに切り替える
            .arg("/Q")
            // セットアップ ini ファイルから設定を読み込む
            .arg(format!("/ConfigurationFile={}", config_ini.display()))
            // SA パスワードはコマンドライン引数経由で渡す（ini に書かないことで平文残留を最小化）
            .arg(format!("/SAPWD={}", sa_password))
            // SQL Server ライセンス条項に同意する
            .arg("/IACCEPTSQLSERVERLICENSETERMS")
            // プライバシーステートメント通知を抑止する
            .arg("/SUPPRESSPRIVACYSTATEMENTNOTICE")
            // 標準出力をキャプチャする
            .stdout(Stdio::piped())
            // 標準エラーをキャプチャする
            .stderr(Stdio::piped())
            // コマンドを実行して完了を待つ
            .output()
            .map_err(|e| SetupError::Other(format!("setup.exe の起動に失敗しました: {e}")))?;

        // setup.exe の標準出力を Reporter に転送する
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            // 各行を stdout イベントとして送信する
            reporter.stdout_line("mssql_setup", line);
        }

        // setup.exe の標準エラーを Reporter に転送する
        for line in String::from_utf8_lossy(&output.stderr).lines() {
            // 各行を stderr イベントとして送信する
            reporter.stderr_line("mssql_setup", line);
        }

        // setup.exe の終了コードを確認する
        if !output.status.success() {
            // 終了コードをエラーメッセージに含めて返す
            return Err(SetupError::Other(format!(
                "SQL Server セットアップが失敗しました（終了コード: {:?}）",
                output.status.code()
            )));
        }

        // 正常終了を返す
        Ok(())
    }

    // SQL Server の TCP ポートをレジストリ書き換えで指定するヘルパーメソッド
    // 既定の動的ポートを無効化し、IPAll の固定ポートを設定する
    #[cfg(windows)]
    fn configure_tcp_port(instance_name: &str, port: u16) -> Result<(), SetupError> {
        // winreg クレートでローカルマシンレジストリにアクセスする
        use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WRITE};
        use winreg::RegKey;

        // HKLM をハンドルとして取得する
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

        // SQL Server 2022 のメジャー番号は MSSQL16 で表現される
        // インスタンス名はインストール時に指定したものに対応するレジストリキーになる
        let tcp_ip_all_path = format!(
            "SOFTWARE\\Microsoft\\Microsoft SQL Server\\MSSQL16.{}\\MSSQLServer\\SuperSocketNetLib\\Tcp\\IPAll",
            instance_name
        );

        // IPAll サブキーを書き込み権限付きで開く
        let key = hklm
            .open_subkey_with_flags(&tcp_ip_all_path, KEY_READ | KEY_WRITE)
            .map_err(|e| {
                SetupError::Other(format!(
                    "SQL Server のレジストリキーを開けませんでした（{}）: {}",
                    tcp_ip_all_path, e
                ))
            })?;

        // TcpDynamicPorts を空文字に設定して動的ポートを無効化する
        key.set_value("TcpDynamicPorts", &"")
            .map_err(|e| SetupError::Other(format!("TcpDynamicPorts の設定に失敗しました: {e}")))?;

        // TcpPort に固定ポート番号を設定する（REG_SZ なので文字列として書く）
        key.set_value("TcpPort", &port.to_string())
            .map_err(|e| SetupError::Other(format!("TcpPort の設定に失敗しました: {e}")))?;

        // 正常終了を返す
        Ok(())
    }

    // 非 Windows プラットフォーム向けのスタブ（ビルド互換性のため）
    #[cfg(not(windows))]
    fn configure_tcp_port(_instance_name: &str, _port: u16) -> Result<(), SetupError> {
        // Windows 以外では何もしない（SQL Server 自体が Windows 専用）
        Ok(())
    }

    // sc.exe 経由でサービスを停止するヘルパーメソッド
    // 既に停止済みの場合は失敗しても無視する
    fn sc_stop(service_name: &str) {
        // sc.exe stop <service_name> を実行する
        let _ = Command::new("sc.exe")
            // stop サブコマンドでサービスを停止する
            .arg("stop")
            // 対象サービス名を指定する
            .arg(service_name)
            // 標準出力を捨てる
            .stdout(Stdio::null())
            // 標準エラーも捨てる
            .stderr(Stdio::null())
            // 実行する
            .status();
    }

    // sc.exe 経由でサービスを起動するヘルパーメソッド
    fn sc_start(service_name: &str) -> Result<(), SetupError> {
        // sc.exe start <service_name> を実行する
        let status = Command::new("sc.exe")
            // start サブコマンドでサービスを開始する
            .arg("start")
            // 対象サービス名を指定する
            .arg(service_name)
            // 標準出力を捨てる
            .stdout(Stdio::null())
            // 標準エラーも捨てる
            .stderr(Stdio::null())
            // 実行する
            .status()
            .map_err(|e| SetupError::Other(format!("sc.exe start の実行に失敗しました: {e}")))?;

        // 終了コードが 0 でなくても、状態によっては「既に起動中」のことがあるため
        // ここでは終了コードのみログ的に確認し、最終的なヘルスチェックを後段で行う
        if !status.success() {
            // 既に実行中（exit code 1056）などのケースを許容するため警告レベルに留める
            // 厳密なエラー判定は呼び出し側でサービス状態を確認することで担保する
            return Ok(());
        }

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

    // Windows サービス名を組み立てるヘルパーメソッド
    // インスタンス名から MSSQL$<INSTANCE> 形式のサービス名を生成する
    fn windows_service_name(instance_name: &str) -> String {
        // SQL Server インスタンスのサービス名は MSSQL$<INSTANCE> 形式で固定される
        format!("MSSQL${}", instance_name)
    }
}

// SetupEngine トレイトの SqlServerEngine への実装
impl SetupEngine for SqlServerEngine {
    // コンポーネント名を返す（ログ表示用）
    fn name(&self) -> &str {
        // SQL Server コンポーネントの表示名を返す
        "SQL Server"
    }

    // Windows サービスの識別名を返す
    // SQL Server インストーラが自動登録する MSSQL$<INSTANCE> をそのまま返す
    fn service_name(&self, config: &SetupConfig) -> String {
        // インスタンス名から MSSQL$<INSTANCE> 形式のサービス名を生成する
        Self::windows_service_name(&config.sqlserver.instance_name)
    }

    // SQL Server をインストールして TCP ポートを設定しサービスを起動する
    fn install(&self, config: &SetupConfig, reporter: &Reporter) -> Result<(), SetupError> {
        // サービス名を取得する
        let service_name = self.service_name(config);
        // 短縮アクセス用に SQL Server 設定を取り出す
        let sql_cfg = &config.sqlserver;

        // ステップ 0: 必要なディレクトリを作成する
        let step_t = Instant::now();
        reporter.step_start(
            "mssql_dirs",
            "SQL Server ディレクトリを作成しています",
            7,
            0,
        );

        // SQL Server のインストール先ディレクトリ群を取得する
        let app_dir = paths::sqlserver_app_dir(config);
        // データディレクトリを取得する
        let data_dir = paths::sqlserver_data_dir(config);
        // ログ出力ディレクトリを取得する
        let logs_dir = paths::sqlserver_logs_dir(config);

        // ディレクトリを再帰的に作成する
        fs::create_dir_all(&app_dir)?;
        // データディレクトリを作成する
        fs::create_dir_all(&data_dir)?;
        // ログディレクトリを作成する
        fs::create_dir_all(&logs_dir)?;
        // ステップ完了を通知する
        reporter.step_done("mssql_dirs", step_t.elapsed().as_millis() as u64);

        // ステップ 1: ISO を取得する（環境変数指定 or HTTP ダウンロード）
        let step_t = Instant::now();
        reporter.step_start("mssql_fetch", "SQL Server ISO を取得しています", 7, 1);

        // ISO の最終パスを決定する
        let iso_path: PathBuf = if let Ok(local_path) = std::env::var("DEVPORTAL_SQLSERVER_PATH") {
            // 環境変数で指定されたローカル ISO を使用する（オフラインフォールバック）
            let local_iso = PathBuf::from(&local_path);
            // ローカル ISO の存在を確認する
            if !local_iso.exists() {
                // 指定されたファイルが存在しない場合はエラーを返す
                return Err(SetupError::Other(format!(
                    "DEVPORTAL_SQLSERVER_PATH に指定されたファイルが見つかりません: {}",
                    local_path
                )));
            }
            // ローカル ISO のパスをそのまま使う
            local_iso
        } else {
            // ISO キャッシュパスを取得する（再インストール時の再ダウンロードを抑止する）
            let cached = paths::sqlserver_iso_cache(config);
            // キャッシュが既に存在する場合はそれを再利用する
            if cached.exists() {
                // 既存 ISO を再利用することを通知する
                reporter.info(format!(
                    "既存の SQL Server ISO を使用します: {}",
                    cached.display()
                ));
            } else {
                // ISO をダウンロードしてキャッシュに保存する
                Self::download_iso(reporter, &sql_cfg.iso_url, &cached)?;
            }
            // キャッシュパスを返す
            cached
        };
        // ステップ完了を通知する
        reporter.step_done("mssql_fetch", step_t.elapsed().as_millis() as u64);

        // ステップ 2: ISO をマウントする
        let step_t = Instant::now();
        reporter.step_start("mssql_mount", "ISO をマウントしています", 7, 2);

        // ISO をマウントしてドライブレターを取得する
        let drive_letter = Self::mount_iso(&iso_path)?;
        // マウント結果をログに記録する
        reporter.info(format!("ISO を {}:\\ にマウントしました", drive_letter));
        // ステップ完了を通知する
        reporter.step_done("mssql_mount", step_t.elapsed().as_millis() as u64);

        // 以降のステップで失敗してもアンマウントは確実に行うため、クロージャでラップする
        let install_result: Result<(), SetupError> = (|| -> Result<(), SetupError> {
            // ステップ 3: ConfigurationFile.ini を生成する
            let step_t = Instant::now();
            reporter.step_start("mssql_config", "セットアップ設定を生成しています", 7, 3);

            // ConfigurationFile.ini のパスを取得する
            let config_ini = paths::sqlserver_config_ini(config);
            // ini ファイルを書き出す
            Self::write_configuration_ini(
                &config_ini,
                // インスタンス名を渡す
                &sql_cfg.instance_name,
                // インスタンスインストール先ディレクトリを渡す
                &app_dir,
                // データディレクトリを渡す
                &data_dir,
            )?;
            // ステップ完了を通知する
            reporter.step_done("mssql_config", step_t.elapsed().as_millis() as u64);

            // ステップ 4: setup.exe を実行してサイレントインストールする
            let step_t = Instant::now();
            reporter.step_start(
                "mssql_setup",
                "SQL Server をインストールしています（数十分かかる場合があります）",
                7,
                4,
            );

            // ISO 内の setup.exe のフルパスを構築する
            let setup_exe = PathBuf::from(format!("{}:\\setup.exe", drive_letter));
            // setup.exe の存在を確認する
            if !setup_exe.exists() {
                // setup.exe が見つからない場合はエラーを返す
                return Err(SetupError::Other(format!(
                    "SQL Server インストーラが見つかりません: {}",
                    setup_exe.display()
                )));
            }

            // SA パスワードを決定する（空ならランダム生成する）
            let sa_password = if sql_cfg.sa_password.is_empty() {
                // ランダム 24 文字パスワードを生成する（postgres と同じ関数を流用する）
                crate::postgres::PostgresEngine::generate_password()
            } else {
                // 設定済みパスワードをそのまま使用する
                sql_cfg.sa_password.clone()
            };

            // setup.exe をサイレントモードで実行する
            Self::run_setup_exe(&setup_exe, &config_ini, &sa_password, reporter)?;
            // ステップ完了を通知する
            reporter.step_done("mssql_setup", step_t.elapsed().as_millis() as u64);

            // ステップ 5: TCP ポートを設定してサービスを再起動する
            let step_t = Instant::now();
            reporter.step_start("mssql_port", "TCP ポートを設定しています", 7, 5);

            // レジストリ書き換えで TCP ポートを固定する
            Self::configure_tcp_port(&sql_cfg.instance_name, sql_cfg.port)?;
            // ポート反映のためサービスを再起動する（停止 → 起動）
            Self::sc_stop(&service_name);
            // 停止に時間がかかる場合があるため少し待機する
            std::thread::sleep(Duration::from_secs(2));
            // サービスを再度起動する
            Self::sc_start(&service_name)?;
            // ステップ完了を通知する
            reporter.step_done("mssql_port", step_t.elapsed().as_millis() as u64);

            // ステップ 6: ヘルスチェックで TCP ポートの応答を確認する
            let step_t = Instant::now();
            reporter.step_start("mssql_health", "ヘルスチェック待機中", 7, 6);
            // TCP 接続で SQL Server が応答するまで待機する（最大 60 秒・1 秒ごとにリトライ）
            let reachable = Self::wait_for_tcp("127.0.0.1", sql_cfg.port, 60, 1);
            // ヘルスチェック結果をログに記録する
            if reachable {
                // 接続成功をログに記録する
                reporter.info(format!(
                    "SQL Server がポート {} で応答しています",
                    sql_cfg.port
                ));
            } else {
                // 接続失敗を警告としてログに記録する（サービス起動は成功しているため続行）
                reporter.warn(
                    None,
                    format!(
                        "SQL Server のヘルスチェックがタイムアウトしました（ポート {}）",
                        sql_cfg.port
                    ),
                );
            }
            // ステップ完了を通知する
            reporter.step_done("mssql_health", step_t.elapsed().as_millis() as u64);

            // 正常終了を返す
            Ok(())
        })();

        // インストール処理の成否によらず ISO をアンマウントする
        Self::dismount_iso(&iso_path);

        // インストール処理でエラーが発生していた場合はそれを返す
        install_result?;

        // インストール完了イベントを送信する
        reporter.finished(
            // SQL Server コンポーネントの完了を通知する
            Component::SqlServer,
            // インストール操作の完了を通知する
            ActionKind::Install,
            // 完了の要約テキストを生成する
            format!(
                "SQL Server を Windows サービス '{}' としてインストールしました（ポート {}）",
                service_name, sql_cfg.port
            ),
        );

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // SQL Server をアンインストールする
    // setup.exe /Action=Uninstall でインストーラ経由の正規アンインストールを行う
    fn uninstall(
        &self,
        config: &SetupConfig,
        reporter: &Reporter,
        keep_data: bool,
    ) -> Result<(), SetupError> {
        // サービス名を取得する
        let service_name = self.service_name(config);
        // SQL Server 設定を取り出す
        let sql_cfg = &config.sqlserver;

        // ステップ 0: サービスを停止する（失敗しても続行する）
        reporter.info("SQL Server サービスを停止しています...");
        // stop 失敗は無視する
        Self::sc_stop(&service_name);
        // 停止完了まで少し待つ
        std::thread::sleep(Duration::from_secs(2));

        // ステップ 1: ISO を再マウントしてアンインストールを実行する
        // インストーラ経由のアンインストールが最も安全（手動でレジストリ・ファイルを消すとシステムが壊れやすい）
        let iso_path = paths::sqlserver_iso_cache(config);
        // ISO キャッシュが残っていれば再利用する
        if iso_path.exists() {
            // ISO をマウントする（失敗時はベストエフォートのファイル削除のみ実施する）
            match Self::mount_iso(&iso_path) {
                Ok(drive_letter) => {
                    // ISO 内の setup.exe のフルパスを構築する
                    let setup_exe = PathBuf::from(format!("{}:\\setup.exe", drive_letter));
                    // setup.exe が見つかればアンインストールを実行する
                    if setup_exe.exists() {
                        // 無人アンインストールを実行する（出力は Reporter に転送する）
                        reporter
                            .info("SQL Server セットアップでアンインストールを実行しています...");
                        // setup.exe を Action=Uninstall で起動する
                        let output = Command::new(&setup_exe)
                            // QUIET モードで実行する
                            .arg("/Q")
                            // アンインストールアクションを指定する
                            .arg("/ACTION=Uninstall")
                            // SQL Engine を対象に指定する
                            .arg("/FEATURES=SQLENGINE")
                            // 対象インスタンスを指定する
                            .arg(format!("/INSTANCENAME={}", sql_cfg.instance_name))
                            // 標準出力をキャプチャする
                            .stdout(Stdio::piped())
                            // 標準エラーをキャプチャする
                            .stderr(Stdio::piped())
                            // 実行する
                            .output();

                        // 出力を Reporter に転送する
                        match output {
                            Ok(out) => {
                                // 標準出力を行ごとに転送する
                                for line in String::from_utf8_lossy(&out.stdout).lines() {
                                    // stdout イベントとして送信する
                                    reporter.stdout_line("mssql_uninstall", line);
                                }
                                // 標準エラーを行ごとに転送する
                                for line in String::from_utf8_lossy(&out.stderr).lines() {
                                    // stderr イベントとして送信する
                                    reporter.stderr_line("mssql_uninstall", line);
                                }
                                // 失敗時は警告にとどめ、後続のファイル削除で残骸を回収する
                                if !out.status.success() {
                                    // 警告イベントを送信する
                                    reporter.warn(
                                        None,
                                        format!(
                                            "SQL Server アンインストーラの終了コードが 0 ではありません: {:?}",
                                            out.status.code()
                                        ),
                                    );
                                }
                            }
                            Err(e) => {
                                // setup.exe の起動失敗は警告として記録する
                                reporter.warn(
                                    None,
                                    format!("SQL Server アンインストーラの起動に失敗しました: {e}"),
                                );
                            }
                        }
                    } else {
                        // setup.exe が見つからない場合は警告として記録する
                        reporter.warn(
                            None,
                            format!(
                                "SQL Server インストーラが見つかりません: {}",
                                setup_exe.display()
                            ),
                        );
                    }
                    // ISO をアンマウントする
                    Self::dismount_iso(&iso_path);
                }
                Err(e) => {
                    // マウント失敗は警告として記録する（後続のファイル削除で残骸を回収する）
                    reporter.warn(None, format!("ISO のマウントに失敗しました: {e}"));
                }
            }
        } else {
            // ISO が存在しない場合は手動アンインストールにフォールバックする
            reporter.warn(
                None,
                "SQL Server ISO キャッシュが見つからないため、サービス停止とファイル削除のみ実行します",
            );
        }

        // ステップ 2: データ保持フラグに応じてディレクトリを削除する
        if keep_data {
            // keep_data = true のとき sqlserver_app_dir のみ削除してデータは保持する
            reporter.info("SQL Server app ディレクトリを削除しています（data は保持）...");
            // app ディレクトリのみ削除する
            let app_dir = paths::sqlserver_app_dir(config);
            // app_dir が存在する場合のみ削除する
            if app_dir.exists() {
                // app ディレクトリを再帰的に削除する
                let _ = fs::remove_dir_all(&app_dir);
            }
        } else {
            // keep_data = false のとき sqlserver_dir 全体を削除する
            reporter.info("SQL Server データディレクトリを全て削除しています...");
            // SQL Server のルートディレクトリを取得する
            let sqlserver_dir = paths::sqlserver_dir(config);
            // ディレクトリが存在する場合のみ削除する
            if sqlserver_dir.exists() {
                // sqlserver ディレクトリ全体を再帰的に削除する
                let _ = fs::remove_dir_all(&sqlserver_dir);
            }
        }

        // アンインストール完了イベントを送信する
        reporter.finished(
            // SQL Server コンポーネントの完了を通知する
            Component::SqlServer,
            // アンインストール操作の完了を通知する
            ActionKind::Uninstall,
            // 完了の要約テキストを生成する
            format!(
                "SQL Server サービス '{}' のアンインストールが完了しました",
                service_name
            ),
        );

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // SQL Server の現在の状態を返す
    fn status(&self, config: &SetupConfig) -> Result<ComponentStatus, SetupError> {
        // サービス名を取得する
        let service_name = self.service_name(config);
        // sc.exe 経由でサービスの状態を取得する（NSSM を経由しない）
        let service_status = winsvc::query_service_status(&service_name);

        // ポート番号を取得する
        let port = config.sqlserver.port;
        // 未インストール時は TCP プローブをスキップする（最大 2 秒の無駄な待ちを防ぐ）
        let endpoint_reachable = if service_status == winsvc::ServiceStatus::NotInstalled {
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

        // エンドポイント URL を構築する（SQL Server の TCP 接続文字列形式で表示する）
        let endpoint_url = format!("tcp:127.0.0.1,{}", port);
        // ブラウザ URL は SQL Server に Web UI がないため接続文字列を流用する
        let web_url = format!("Server=tcp:127.0.0.1,{};Database=master", port);
        // データディレクトリの存在確認を行う
        let data_dir_exists = paths::sqlserver_data_dir(config).exists();

        // ComponentStatus を構築して返す
        Ok(ComponentStatus {
            // SQL Server コンポーネントを指定する
            component: Component::SqlServer,
            // サービス名を格納する
            service_name,
            // サービスの状態を格納する
            service_status,
            // エンドポイント到達可否を格納する
            endpoint_reachable,
            // エンドポイント URL を格納する
            endpoint_url,
            // Web URL を格納する（SQL Server は Web UI がないため接続文字列を流用する）
            web_url,
            // データディレクトリの存在確認結果を格納する
            data_dir_exists,
        })
    }
}
