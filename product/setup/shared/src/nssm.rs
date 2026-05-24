// このファイルは NSSM (Non-Sucking Service Manager) のラッパ構造体を定義する
// nssm.exe を使って Windows サービスのインストール・管理を行う機能を提供する
// サービス設定（AppParameters、AppDirectory 等）は nssm set の代わりに
// winreg と sc.exe で直接書き込む（NSSM の "not a valid NSSM service" 検証をバイパスする）

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
    // reporter: 各ステップの進行状況を GUI/CLI ログに表示するために使用する
    pub fn install(&self, name: &str, exe: &str, reporter: &Reporter) -> Result<(), SetupError> {
        // ベストエフォートで既存サービスを停止する（失敗は無視）
        reporter.info(format!(
            "[クリーンアップ] 既存サービス '{}' の停止を試行",
            name
        ));
        let _ = self.stop(name);

        // ベストエフォートで NSSM 経由のサービス削除を試みる（失敗は無視）
        reporter.info(format!(
            "[クリーンアップ] 既存サービス '{}' の NSSM remove を試行",
            name
        ));
        let _ = self.run_nssm(&["remove", name, "confirm"]);

        // ベストエフォートで sc.exe 経由の削除を試みる（NSSM remove が失敗した場合の保険）
        reporter.info(format!(
            "[クリーンアップ] 既存サービス '{}' の sc.exe delete を試行",
            name
        ));
        self.run_system_cmd_ignore("sc.exe", &["delete", name]);

        // レジストリ残骸を再帰削除する（NSSM の Parameters 初期化を阻害しないよう先に消す）
        reporter.info(format!(
            "[クリーンアップ] レジストリ HKLM\\SYSTEM\\CurrentControlSet\\Services\\{} を削除を試行",
            name
        ));
        self.delete_service_registry(name);

        // SCM がサービス削除を内部的に完了するまで短時間待機する
        reporter.info("[クリーンアップ] SCM の遅延削除待機中（500ms）...");
        std::thread::sleep(std::time::Duration::from_millis(500));

        // nssm install でサービスを SCM に登録し Parameters\Application を初期化する
        reporter.info(format!("[インストール] nssm install '{}' を実行", name));
        self.run_nssm(&["install", name, exe])?;

        // nssm install は稀に Application を空文字列で書き込む（NSSM 2.24 の既知バグ）
        // winreg で明示的に上書き設定して空値問題を確実に排除する
        reporter.info(format!(
            "[インストール] Application を winreg で明示設定 ('{}' = '{}')",
            name, exe
        ));
        self.write_param_expand_sz(name, "Application", exe)?;

        // Parameters\Application が実際に非空の値で書き込まれたことを winreg で検証する
        // nssm install は exit 0 を返しても稀に Parameters を書かないことがあるため
        reporter.info(format!(
            "[検証] Parameters\\Application の書き込みを確認 ('{}')",
            name
        ));
        self.verify_parameters_application(name)?;

        reporter.info(format!("[検証] OK: nssm install が正常に完了 ('{}')", name));
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

    // 終了コードを確認してシステムコマンドを実行するヘルパー（成功必須）
    // sc.exe config など、失敗した場合はエラーを返す場面で使用する
    fn run_system_cmd_strict(&self, program: &str, args: &[&str]) -> Result<(), SetupError> {
        // 指定したプログラムで Command を構築する
        let mut cmd = Command::new(program);
        // 引数を順番に追加する
        for arg in args {
            cmd.arg(arg);
        }
        // 標準出力をキャプチャする
        cmd.stdout(Stdio::piped());
        // 標準エラーをキャプチャする
        cmd.stderr(Stdio::piped());
        // コンソールウィンドウを非表示にする
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        // コマンドのデバッグ文字列を保持する（エラーメッセージ用）
        let cmd_str = format!("{:?}", cmd);
        // コマンドを実行して出力を待つ
        let output = cmd.output().map_err(SetupError::Io)?;
        // 終了コードが 0 以外の場合はエラーを返す
        if !output.status.success() {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
            .trim()
            .to_string();
            return Err(SetupError::NssmFailed {
                cmd: cmd_str,
                output: combined,
            });
        }
        Ok(())
    }

    // HKLM\SYSTEM\CurrentControlSet\Services\<name> をレジストリから再帰削除する
    // nssm install の Parameters 初期化を阻害する残骸を事前に除去するために使用する
    // 削除失敗はログ出力もせずに無視する（ベストエフォート処理）
    #[cfg(windows)]
    fn delete_service_registry(&self, name: &str) {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
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
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        // Parameters サブキーのパスを構築する
        let key_path = format!("SYSTEM\\CurrentControlSet\\Services\\{}\\Parameters", name);
        // HKLM を事前定義ハンドルとして取得する
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        // Parameters キーを書き込み可能で開く（NSSM の検証と同じアクセス権を確認するため）
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
        let app_val: String =
            params_key
                .get_value("Application")
                .map_err(|_| SetupError::NssmFailed {
                    cmd: format!(
                        "winreg verify ...\\Services\\{}\\Parameters\\Application",
                        name
                    ),
                    output: format!(
                        "Parameters\\Application が書き込まれていません。サービス名: {}",
                        name
                    ),
                })?;
        // Application が空文字列の場合は NSSM がサービスを起動できないためエラーとする
        if app_val.trim().is_empty() {
            return Err(SetupError::NssmFailed {
                cmd: format!(
                    "winreg verify ...\\Services\\{}\\Parameters\\Application",
                    name
                ),
                output: format!(
                    "Parameters\\Application が空文字列です。サービス名: {}",
                    name
                ),
            });
        }
        Ok(())
    }

    // Windows 以外のプラットフォーム向けのスタブ（コンパイルエラー回避）
    #[cfg(not(windows))]
    fn verify_parameters_application(&self, _name: &str) -> Result<(), SetupError> {
        Ok(())
    }

    // サービスのプロパティを winreg / sc.exe で直接設定する汎用メソッド
    // nssm set を使わずに直接レジストリへ書き込む。NSSM の "not a valid NSSM service"
    // 検証をバイパスするために必要な対策。
    // 新しい NSSM パラメータが必要になった場合は以下のディスパッチテーブルに追加する。
    pub fn set(&self, name: &str, key: &str, value: &str) -> Result<(), SetupError> {
        // key 名に応じて書き込み方法を切り替える（Windows 専用実装に委譲）
        self.set_impl(name, key, value)
    }

    // Windows 向けのディスパッチ実装
    #[cfg(windows)]
    fn set_impl(&self, name: &str, key: &str, value: &str) -> Result<(), SetupError> {
        match key {
            // REG_EXPAND_SZ として Parameters キー配下に書き込む
            "Application" | "AppParameters" | "AppDirectory" | "AppStdout" | "AppStderr" => {
                self.write_param_expand_sz(name, key, value)
            }
            // REG_DWORD として Parameters キー配下に書き込む（文字列を u32 にパース）
            "AppRotateFiles"
            | "AppRotateBytes"
            | "AppRestartDelay"
            | "AppStopMethodConsole"
            | "AppStopMethodWindow"
            | "AppStopMethodThreads"
            | "AppThrottle" => {
                // 文字列値を u32 にパースする
                let dword = value.parse::<u32>().map_err(|e| {
                    SetupError::Other(format!(
                        "NSSM パラメータ '{}' の値 '{}' を u32 にパースできません: {}",
                        key, value, e
                    ))
                })?;
                self.write_param_dword(name, key, dword)
            }
            // REG_MULTI_SZ として既存値に追記する（NSSM の累積動作を再現）
            "AppEnvironmentExtra" => self.append_param_multi_sz(name, key, value),
            // SCM の DisplayName を sc.exe config で設定する
            "DisplayName" => {
                self.run_system_cmd_strict("sc.exe", &["config", name, "DisplayName=", value])
            }
            // SCM の Description を sc.exe description で設定する
            "Description" => self.run_system_cmd_strict("sc.exe", &["description", name, value]),
            // SCM の StartType を sc.exe config で設定する（NSSM 文字列を sc.exe 形式に変換）
            "Start" => self.sc_config_start(name, value),
            // 未対応のパラメータはエラーとして返す（新規パラメータは上記に追加すること）
            _ => Err(SetupError::Other(format!(
                "未対応の NSSM パラメータ名: '{}'. nssm.rs の set_impl に追加が必要です。",
                key
            ))),
        }
    }

    // Windows 以外のプラットフォーム向けのスタブ（コンパイルエラー回避）
    #[cfg(not(windows))]
    fn set_impl(&self, _name: &str, _key: &str, _value: &str) -> Result<(), SetupError> {
        Ok(())
    }

    // NSSM Start 文字列を sc.exe の start= 形式に変換してサービス起動種別を設定する
    #[cfg(windows)]
    fn sc_config_start(&self, name: &str, nssm_value: &str) -> Result<(), SetupError> {
        // NSSM の Start 文字列を sc.exe の start= 引数に変換する
        let sc_type = match nssm_value {
            // 自動起動
            "SERVICE_AUTO_START" => "auto",
            // 手動起動
            "SERVICE_DEMAND_START" => "demand",
            // 無効
            "SERVICE_DISABLED" => "disabled",
            // 未対応の値はエラー
            _ => {
                return Err(SetupError::Other(format!(
                    "未対応の Start 値: '{}'. SERVICE_AUTO_START / SERVICE_DEMAND_START / SERVICE_DISABLED のみ対応。",
                    nssm_value
                )));
            }
        };
        // sc.exe config <name> start= <type> を実行する
        self.run_system_cmd_strict("sc.exe", &["config", name, "start=", sc_type])
    }

    // Windows 以外のプラットフォーム向けのスタブ（コンパイルエラー回避）
    #[cfg(not(windows))]
    fn sc_config_start(&self, _name: &str, _nssm_value: &str) -> Result<(), SetupError> {
        Ok(())
    }

    // Parameters\<value_name> を REG_EXPAND_SZ として書き込む
    // AppDirectory, AppStdout, AppStderr, AppParameters 等の文字列パスに使用する
    #[cfg(windows)]
    fn write_param_expand_sz(
        &self,
        service_name: &str,
        value_name: &str,
        value: &str,
    ) -> Result<(), SetupError> {
        use winreg::enums::{HKEY_LOCAL_MACHINE, REG_EXPAND_SZ};
        use winreg::RegKey;
        use winreg::RegValue;
        // HKLM を事前定義ハンドルとして取得する
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        // Parameters サブキーのパスを構築する
        let key_path = format!(
            "SYSTEM\\CurrentControlSet\\Services\\{}\\Parameters",
            service_name
        );
        // Parameters キーを作成または開く（create_subkey は存在する場合は開く）
        let (params_key, _) = hklm.create_subkey(&key_path).map_err(|e| {
            SetupError::Other(format!("{} の Parameters キー: {}", service_name, e))
        })?;
        // 値を UTF-16LE + null terminator にエンコードする
        let wide: Vec<u8> = value
            .encode_utf16()
            .chain(std::iter::once(0u16))
            .flat_map(|c| c.to_le_bytes())
            .collect();
        // REG_EXPAND_SZ として書き込む
        params_key
            .set_raw_value(
                value_name,
                &RegValue {
                    bytes: wide,
                    vtype: REG_EXPAND_SZ,
                },
            )
            .map_err(|e| {
                SetupError::Other(format!(
                    "{} への {} 書き込み失敗: {}",
                    service_name, value_name, e
                ))
            })?;
        Ok(())
    }

    // Windows 以外のプラットフォーム向けのスタブ（コンパイルエラー回避）
    #[cfg(not(windows))]
    fn write_param_expand_sz(&self, _: &str, _: &str, _: &str) -> Result<(), SetupError> {
        Ok(())
    }

    // Parameters\<value_name> を REG_DWORD として書き込む
    // AppRotateFiles, AppRestartDelay 等の数値パラメータに使用する
    #[cfg(windows)]
    fn write_param_dword(
        &self,
        service_name: &str,
        value_name: &str,
        value: u32,
    ) -> Result<(), SetupError> {
        use winreg::enums::{HKEY_LOCAL_MACHINE, REG_DWORD};
        use winreg::RegKey;
        use winreg::RegValue;
        // HKLM を事前定義ハンドルとして取得する
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        // Parameters サブキーのパスを構築する
        let key_path = format!(
            "SYSTEM\\CurrentControlSet\\Services\\{}\\Parameters",
            service_name
        );
        // Parameters キーを作成または開く
        let (params_key, _) = hklm.create_subkey(&key_path).map_err(|e| {
            SetupError::Other(format!("{} の Parameters キー: {}", service_name, e))
        })?;
        // 4 バイト little-endian として書き込む
        params_key
            .set_raw_value(
                value_name,
                &RegValue {
                    bytes: value.to_le_bytes().to_vec(),
                    vtype: REG_DWORD,
                },
            )
            .map_err(|e| {
                SetupError::Other(format!(
                    "{} への {} 書き込み失敗: {}",
                    service_name, value_name, e
                ))
            })?;
        Ok(())
    }

    // Windows 以外のプラットフォーム向けのスタブ（コンパイルエラー回避）
    #[cfg(not(windows))]
    fn write_param_dword(&self, _: &str, _: &str, _: u32) -> Result<(), SetupError> {
        Ok(())
    }

    // Parameters\<value_name> を REG_MULTI_SZ として既存値に追記する
    // NSSM の nssm set AppEnvironmentExtra は累積動作なので同じ挙動を再現する
    #[cfg(windows)]
    fn append_param_multi_sz(
        &self,
        service_name: &str,
        value_name: &str,
        entry: &str,
    ) -> Result<(), SetupError> {
        use winreg::enums::{HKEY_LOCAL_MACHINE, REG_MULTI_SZ};
        use winreg::RegKey;
        use winreg::RegValue;
        // HKLM を事前定義ハンドルとして取得する
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        // Parameters サブキーのパスを構築する
        let key_path = format!(
            "SYSTEM\\CurrentControlSet\\Services\\{}\\Parameters",
            service_name
        );
        // Parameters キーを作成または開く
        let (params_key, _) = hklm.create_subkey(&key_path).map_err(|e| {
            SetupError::Other(format!("{} の Parameters キー: {}", service_name, e))
        })?;
        // 既存の MULTI_SZ 値を読み出す（存在しない場合は空配列として扱う）
        let mut existing: Vec<String> = params_key.get_value(value_name).unwrap_or_default();
        // 新規エントリを末尾に追記する
        existing.push(entry.to_string());
        // MULTI_SZ として書き戻す（null 区切り UTF-16LE + 末尾ダブル null）
        let mut wide_bytes: Vec<u8> = Vec::new();
        for s in &existing {
            // 各文字列を UTF-16LE エンコードして null terminator を付ける
            for c in s.encode_utf16() {
                wide_bytes.extend_from_slice(&c.to_le_bytes());
            }
            // 各文字列の末尾に null を追加する（MULTI_SZ の区切り）
            wide_bytes.extend_from_slice(&0u16.to_le_bytes());
        }
        // リスト末尾に追加の null を書いて MULTI_SZ の終端とする
        wide_bytes.extend_from_slice(&0u16.to_le_bytes());
        // REG_MULTI_SZ として書き込む
        params_key
            .set_raw_value(
                value_name,
                &RegValue {
                    bytes: wide_bytes,
                    vtype: REG_MULTI_SZ,
                },
            )
            .map_err(|e| {
                SetupError::Other(format!(
                    "{} への {} 書き込み失敗: {}",
                    service_name, value_name, e
                ))
            })?;
        Ok(())
    }

    // Windows 以外のプラットフォーム向けのスタブ（コンパイルエラー回避）
    #[cfg(not(windows))]
    fn append_param_multi_sz(&self, _: &str, _: &str, _: &str) -> Result<(), SetupError> {
        Ok(())
    }

    // NSSM の AppExit パラメータを winreg で直接設定する
    // AppExit は Parameters 配下のサブキーとして存在し、終了コードをキー名・動作を値として保持する
    // exit_code: 対象の終了コード文字列（"Default" または "0" 等の数値文字列）
    // action: 動作文字列（"Restart" / "Ignore" / "Exit" / "Suicide"）
    pub fn set_app_exit(
        &self,
        service_name: &str,
        exit_code: &str,
        action: &str,
    ) -> Result<(), SetupError> {
        // Windows 専用実装に委譲する
        self.set_app_exit_impl(service_name, exit_code, action)
    }

    // Windows 向けの AppExit 設定実装
    #[cfg(windows)]
    fn set_app_exit_impl(
        &self,
        service_name: &str,
        exit_code: &str,
        action: &str,
    ) -> Result<(), SetupError> {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        // HKLM を事前定義ハンドルとして取得する
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        // AppExit サブキーのパスを構築する
        // NSSM は Parameters\AppExit を独立したサブキーとして管理する
        let key_path = format!(
            "SYSTEM\\CurrentControlSet\\Services\\{}\\Parameters\\AppExit",
            service_name
        );
        // AppExit サブキーを作成または開く
        let (exit_key, _) = hklm.create_subkey(&key_path).map_err(|e| {
            SetupError::Other(format!("{} の AppExit キー作成失敗: {}", service_name, e))
        })?;
        // 終了コードを値名として、動作文字列を REG_SZ として書き込む
        exit_key
            .set_value(exit_code, &action.to_string())
            .map_err(|e| {
                SetupError::Other(format!(
                    "{} の AppExit\\{} 書き込み失敗: {}",
                    service_name, exit_code, e
                ))
            })?;
        Ok(())
    }

    // Windows 以外のプラットフォーム向けのスタブ（コンパイルエラー回避）
    #[cfg(not(windows))]
    fn set_app_exit_impl(
        &self,
        _service_name: &str,
        _exit_code: &str,
        _action: &str,
    ) -> Result<(), SetupError> {
        Ok(())
    }

    // サービスを開始する
    // sc.exe start で発火するだけで SERVICE_RUNNING への到達を待たない
    // Backstage のように起動に時間がかかるサービスは NSSM start がタイムアウトしてエラーになるため
    // 起動完了の確認は呼び出し元のヘルスチェック（TCP 接続確認）に委ねる
    pub fn start(&self, name: &str) -> Result<(), SetupError> {
        // sc.exe start は発火だけを行い、SERVICE_RUNNING への到達確認は呼び出し元に委ねる。
        // ただしサービス未登録などの明確な起動失敗は呼び出し元へ返す。
        self.run_system_cmd_strict("sc.exe", &["start", name])
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
    // set() を使って各プロパティを winreg / sc.exe で設定する
    #[allow(clippy::too_many_arguments)]
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

        // サービス終了時のデフォルト動作を再起動に設定する（winreg 直書き）
        self.set_app_exit(name, "Default", "Restart")?;

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
            // AppEnvironmentExtra キーで環境変数を累積追記する
            self.set(name, "AppEnvironmentExtra", &env_entry)?;
        }

        // 全設定の完了を示す Ok(()) を返す
        Ok(())
    }
}
