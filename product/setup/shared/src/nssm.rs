// このファイルは NSSM (Non-Sucking Service Manager) CLI のラッパ構造体を定義する
// nssm.exe を使って Windows サービスのインストール・管理を行う機能を提供する

// ファイルシステムパスを扱うために PathBuf を使用する
use std::path::PathBuf;

// 外部コマンド実行に必要な型をインポートする
use std::process::{Command, Stdio};

// 独自エラー型を参照するために使用する
use crate::error::SetupError;

// 進捗通知のために Reporter をインポートする
use crate::event::Reporter;

// サービス状態を表す列挙型を参照するために使用する
use crate::winsvc::ServiceStatus;

// Nssm: NSSM バイナリへのラッパ構造体
// nssm.exe のフルパスを保持してサービス管理コマンドを実行する
pub struct Nssm {
    // NSSM バイナリのフルパス（コマンド実行時に使用する）
    nssm_path: PathBuf,
}

// Nssm のメソッド実装ブロック
impl Nssm {
    // nssm_path からインスタンスを作成する
    pub fn new(nssm_path: PathBuf) -> Self {
        // フィールドを初期化して Nssm インスタンスを返す
        Self { nssm_path }
    }

    // paths::resolve_nssm_path() を使い NSSM パスを自動解決してインスタンスを作成する
    // NSSM が見つからない場合は SetupError::NssmNotFound を返す
    pub fn from_env() -> Result<Self, SetupError> {
        // paths モジュールの resolve_nssm_path を使って NSSM のパスを解決する
        let path = crate::paths::resolve_nssm_path()?;
        // 解決したパスで Nssm インスタンスを作成して返す
        Ok(Self::new(path))
    }

    // NSSM を「キャッシュ確認 → 必要なら動的ダウンロード」で確保してインスタンスを作成する
    // reporter: ダウンロード進捗を通知するための Reporter への参照
    // キャッシュが存在する場合はダウンロードをスキップして即時返す
    // NSSM が見つからずダウンロードも失敗した場合はエラーを返す
    pub fn ensure(reporter: &Reporter) -> Result<Self, SetupError> {
        // まず環境変数またはキャッシュから NSSM を解決する（高速パス）
        match crate::paths::resolve_nssm_path() {
            // NSSM が見つかった場合はそのパスで Nssm インスタンスを作成して返す
            Ok(path) => Ok(Self::new(path)),
            // 見つからない場合は動的ダウンロードにフォールバックする
            Err(SetupError::NssmNotFound(_)) => {
                // nssm_fetcher で NSSM を HTTP 取得・検証・配置する
                let path = crate::nssm_fetcher::ensure_nssm(reporter)?;
                // 取得したパスで Nssm インスタンスを作成して返す
                Ok(Self::new(path))
            }
            // その他のエラーはそのまま返す
            Err(e) => Err(e),
        }
    }

    // NSSM コマンドを実行するプライベートヘルパーメソッド
    // コマンドが失敗した場合は NssmFailed エラーを返す
    fn run_nssm(&self, args: &[&str]) -> Result<(), SetupError> {
        // NSSM バイナリのパスで Command を作成する
        let mut cmd = Command::new(&self.nssm_path);
        // 引数を順番に追加する
        for arg in args {
            // 各引数を個別に追加する
            cmd.arg(arg);
        }
        // 標準出力をキャプチャする（エラーメッセージ取得のため）
        cmd.stdout(Stdio::piped());
        // 標準エラーをキャプチャする（エラーメッセージ取得のため）
        cmd.stderr(Stdio::piped());
        // コンソールウィンドウを非表示にする（NSSM の GUI が出ないようにする）
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW フラグを設定してウィンドウなしで起動する
            cmd.creation_flags(0x0800_0000);
        }

        // コマンドのデバッグ文字列表現を構築する（エラーメッセージ用）
        let cmd_str = format!("{:?}", cmd);

        // コマンドを実行して出力を待つ
        let output = cmd
            .output()
            // I/O エラーを SetupError::Io に変換する
            .map_err(SetupError::Io)?;

        // stdout と stderr を UTF-8 文字列に変換する（NSSM は UTF-16 出力のため lossy 変換）
        let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
        // stderr 文字列を取得する
        let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();
        // stdout と stderr を改行で結合してエラーメッセージとする
        let combined = format!("{}\n{}", stdout_str, stderr_str).trim().to_string();

        // NSSM 2.24 は管理者権限不足でも exit code 0 を返すため stderr も確認する
        // exit code 0 かつ stderr が空でない場合も失敗とみなす
        if !output.status.success() || !stderr_str.trim().is_empty() {
            // NssmFailed エラーを返す
            return Err(SetupError::NssmFailed {
                // コマンドのデバッグ文字列を格納する
                cmd: cmd_str,
                // 結合した出力文字列を格納する
                output: combined,
            });
        }

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // サービスを SCM に登録する（クリーンアップ + 検証付き冪等インストール）
    // 既存のサービスやレジストリ残骸をすべて除去してから nssm install を実行し
    // Parameters\Application が正しく書き込まれたことをレジストリで事後検証する
    pub fn install(&self, name: &str, exe: &str) -> Result<(), SetupError> {
        // ベストエフォートで既存サービスを停止する（失敗は無視）
        let _ = self.stop(name);

        // ベストエフォートで NSSM 経由のサービス削除を試みる（失敗は無視）
        let _ = self.run_nssm(&["remove", name, "confirm"]);

        // ベストエフォートで sc.exe 経由の削除を試みる（NSSM remove が失敗した場合の保険）
        self.run_system_cmd_ignore("sc.exe", &["delete", name]);

        // レジストリ残骸を再帰削除する（NSSM の Parameters 初期化を阻害しないよう先に消す）
        self.delete_service_registry(name);

        // SCM がサービス削除を内部的に完了するまで短時間待機する
        std::thread::sleep(std::time::Duration::from_millis(500));

        // nssm install でサービスを SCM に登録し Parameters\Application を初期化する
        self.run_nssm(&["install", name, exe])?;

        // Parameters\Application が実際に書き込まれたことを winreg で検証する
        // nssm install は exit 0 を返しても稀に Parameters を書かないことがあるため
        self.verify_parameters_application(name)?;

        Ok(())
    }

    // 終了コードを無視してシステムコマンドを実行するヘルパー（クリーンアップ用）
    // sc.exe delete など、失敗してもインストールを続行すべき場面で使用する
    fn run_system_cmd_ignore(&self, program: &str, args: &[&str]) {
        // 指定したプログラムで Command を構築する
        let mut cmd = Command::new(program);
        // 引数を順番に追加する
        for arg in args {
            cmd.arg(arg);
        }
        // 出力を破棄する（エラー情報は不要）
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::null());
        // コンソールウィンドウを非表示にする
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        // 失敗しても Result を返さない（呼び出し元でエラーは無視する）
        let _ = cmd.output();
    }

    // HKLM\SYSTEM\CurrentControlSet\Services\<name> をレジストリから再帰削除する
    // nssm install の Parameters 初期化を阻害する残骸を事前に除去するために使用する
    // 削除失敗はログ出力もせずに無視する（ベストエフォート処理）
    #[cfg(windows)]
    fn delete_service_registry(&self, name: &str) {
        use winreg::RegKey;
        use winreg::enums::HKEY_LOCAL_MACHINE;
        // 削除対象のキーパスを構築する
        let key_path = format!("SYSTEM\\CurrentControlSet\\Services\\{}", name);
        // HKLM を事前定義ハンドルとして取得する
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        // delete_subkey_all はサブキーを含めて再帰的に削除する
        let _ = hklm.delete_subkey_all(&key_path);
    }

    // Windows 以外のプラットフォーム向けのスタブ（コンパイルエラー回避）
    #[cfg(not(windows))]
    fn delete_service_registry(&self, _name: &str) {}

    // nssm install 後に HKLM\...\Parameters\Application が存在するか winreg で検証する
    // 値が存在しない場合は NssmFailed エラーを返して上位に伝播させる
    #[cfg(windows)]
    fn verify_parameters_application(&self, name: &str) -> Result<(), SetupError> {
        use winreg::RegKey;
        use winreg::enums::HKEY_LOCAL_MACHINE;
        // Parameters サブキーのパスを構築する
        let key_path = format!(
            "SYSTEM\\CurrentControlSet\\Services\\{}\\Parameters",
            name
        );
        // HKLM を事前定義ハンドルとして取得する
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        // Parameters キーを読み取り専用で開く（存在しない場合はエラー）
        let params_key = hklm
            .open_subkey(&key_path)
            .map_err(|_| SetupError::NssmFailed {
                cmd: format!(
                    "winreg verify HKLM\\SYSTEM\\CurrentControlSet\\Services\\{}\\Parameters",
                    name
                ),
                output: format!(
                    "NSSM install は exit 0 を返したが Parameters キーが作成されていません。\
                    \nサービス名: {}\
                    \n古いレジストリ残骸の影響か NSSM のサイレント失敗の可能性があります。\
                    \n管理者 PowerShell で次を実行してから再試行してください:\
                    \n  sc.exe delete {} \
                    \n  Remove-Item \"HKLM:\\SYSTEM\\CurrentControlSet\\Services\\{}\" -Recurse -Force",
                    name, name, name
                ),
            })?;
        // Application 値を読み出す（存在しない場合はエラー）
        let _: String = params_key
            .get_value("Application")
            .map_err(|_| SetupError::NssmFailed {
                cmd: format!(
                    "winreg verify HKLM\\SYSTEM\\CurrentControlSet\\Services\\{}\\Parameters\\Application",
                    name
                ),
                output: format!(
                    "NSSM install は exit 0 を返したが Parameters\\Application が書き込まれていません。\
                    \nサービス名: {}\
                    \n古いレジストリ残骸の影響か NSSM のサイレント失敗の可能性があります。\
                    \n管理者 PowerShell で次を実行してから再試行してください:\
                    \n  sc.exe delete {} \
                    \n  Remove-Item \"HKLM:\\SYSTEM\\CurrentControlSet\\Services\\{}\" -Recurse -Force",
                    name, name, name
                ),
            })?;
        Ok(())
    }

    // Windows 以外のプラットフォーム向けのスタブ（コンパイルエラー回避）
    #[cfg(not(windows))]
    fn verify_parameters_application(&self, _name: &str) -> Result<(), SetupError> {
        Ok(())
    }

    // サービスのプロパティを設定する汎用メソッド
    // nssm set <name> <key> <value> を実行する
    pub fn set(&self, name: &str, key: &str, value: &str) -> Result<(), SetupError> {
        // set サブコマンドの引数リストを構築して NSSM を実行する
        self.run_nssm(&["set", name, key, value])
    }

    // サービスを開始する
    // nssm start <name> を実行する
    pub fn start(&self, name: &str) -> Result<(), SetupError> {
        // start サブコマンドの引数リストを構築して NSSM を実行する
        self.run_nssm(&["start", name])
    }

    // サービスを停止する（タイムアウト: 30 秒）
    // nssm stop <name> を実行する
    pub fn stop(&self, name: &str) -> Result<(), SetupError> {
        // stop サブコマンドの引数リストを構築して NSSM を実行する
        // NSSM のデフォルトタイムアウトは設定済みのため追加指定は不要
        self.run_nssm(&["stop", name])
    }

    // サービスを削除する
    // nssm remove <name> confirm を実行する（confirm で確認ダイアログをスキップ）
    pub fn remove(&self, name: &str) -> Result<(), SetupError> {
        // remove サブコマンドに confirm を付けてダイアログなしで削除する
        self.run_nssm(&["remove", name, "confirm"])
    }

    // サービスの状態を返す（winsvc::query_service_status を呼ぶ）
    pub fn status(&self, name: &str) -> ServiceStatus {
        // winsvc モジュールの関数を使ってサービス状態を取得する
        crate::winsvc::query_service_status(name)
    }

    // サービスの完全設定を一括で行うヘルパメソッド
    // 計画書の NSSM コマンド発行順に従って各プロパティを設定する
    pub fn configure_service(
        &self,
        // Windows サービスの識別名（sc.exe でも使用する名前）
        name: &str,
        // サービス管理ツールに表示される表示名
        display_name: &str,
        // サービスの説明文
        description: &str,
        // 作業ディレクトリのフルパス
        work_dir: &str,
        // 標準出力のログファイルパス
        stdout_log: &str,
        // 標準エラーのログファイルパス
        stderr_log: &str,
        // 追加の環境変数リスト（キーと値のペア）
        env_extras: &[(&str, &str)],
    ) -> Result<(), SetupError> {
        // 作業ディレクトリ（AppDirectory）を設定する
        self.set(name, "AppDirectory", work_dir)?;

        // 標準出力のログファイルパス（AppStdout）を設定する
        self.set(name, "AppStdout", stdout_log)?;

        // 標準エラーのログファイルパス（AppStderr）を設定する
        self.set(name, "AppStderr", stderr_log)?;

        // ログローテーションを有効にする（AppRotateFiles = 1）
        self.set(name, "AppRotateFiles", "1")?;

        // ログローテーションのサイズ閾値を設定する（10MB = 10485760 バイト）
        self.set(name, "AppRotateBytes", "10485760")?;

        // サービスの表示名（DisplayName）を設定する
        self.set(name, "DisplayName", display_name)?;

        // サービスの説明文（Description）を設定する
        self.set(name, "Description", description)?;

        // サービスの起動方法を自動起動（SERVICE_AUTO_START）に設定する
        self.set(name, "Start", "SERVICE_AUTO_START")?;

        // サービス終了時のデフォルト動作を再起動に設定する
        // AppExit は <exitcode> と <action> が別引数になるため run_nssm を直接呼ぶ
        self.run_nssm(&["set", name, "AppExit", "Default", "Restart"])?;

        // サービス再起動前の待機時間をミリ秒で設定する（5 秒）
        self.set(name, "AppRestartDelay", "5000")?;

        // Ctrl+C シグナルによるプロセス停止タイムアウト（15 秒）を設定する
        self.set(name, "AppStopMethodConsole", "15000")?;

        // ウィンドウメッセージによるプロセス停止タイムアウト（5 秒）を設定する
        self.set(name, "AppStopMethodWindow", "5000")?;

        // スレッド終了によるプロセス停止タイムアウト（5 秒）を設定する
        self.set(name, "AppStopMethodThreads", "5000")?;

        // 追加の環境変数を設定する（指定がある場合のみ）
        for (key, value) in env_extras {
            // 環境変数キーと値を結合して AppEnvironmentExtra 形式で設定する
            let env_entry = format!("{}={}", key, value);
            // AppEnvironmentExtra キーで環境変数を追加する
            self.set(name, "AppEnvironmentExtra", &env_entry)?;
        }

        // 全設定の完了を示す Ok(()) を返す
        Ok(())
    }
}
