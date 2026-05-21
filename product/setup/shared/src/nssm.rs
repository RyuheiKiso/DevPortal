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

    // nssm install <name> <exe> でサービスを SCM に登録し Parameters を初期化する
    // requireAdministrator により管理者権限で実行されるため NSSM の SCM 操作が成功する
    pub fn install(&self, name: &str, exe: &str) -> Result<(), SetupError> {
        // install サブコマンドでサービス登録と Parameters レジストリ初期化を一括実行する
        self.run_nssm(&["install", name, exe])
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
