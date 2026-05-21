// このファイルはセットアップで使用する各種パスの解決ロジックを定義する
// Windows の %ProgramData% や実行ファイルパスを基準にパスを構築する

// ファイルシステムパスを扱うために PathBuf を使用する
use std::path::PathBuf;

// SetupConfig からインストールルートを参照するために使用する
use crate::config::SetupConfig;

// セットアップエラー型を参照するために使用する
use crate::error::SetupError;

// DevPortal のインストールルートディレクトリを返す関数
// config.install_root が Some のときはその値を、None のとき %ProgramData%\DevPortal を返す
pub fn devportal_root(config: &SetupConfig) -> PathBuf {
    // install_root が明示的に指定されている場合はそれを使用する
    if let Some(root) = &config.install_root {
        // 指定されたパスをクローンして返す
        return root.clone();
    }
    // Windows 環境では directories クレートで %ProgramData% を取得する
    #[cfg(windows)]
    {
        // BaseDirs でシステムのデータディレクトリを取得する
        if let Some(base) = directories::BaseDirs::new() {
            // data_dir() は Windows では %AppData%（Roaming）を返すため、
            // %ProgramData% に相当する PROGRAMDATA 環境変数を直接参照する
            let _ = base; // directories の BaseDirs は ProgramData を直接提供しない
        }
        // PROGRAMDATA 環境変数から %ProgramData% のパスを取得する
        let program_data = std::env::var("PROGRAMDATA")
            // 環境変数が取得できない場合は C:\ProgramData をフォールバックとして使用する
            .unwrap_or_else(|_| r"C:\ProgramData".to_string());
        // %ProgramData%\DevPortal のパスを構築して返す
        PathBuf::from(program_data).join("DevPortal")
    }
    // 非 Windows 環境（テスト・CI 用）では /tmp/DevPortal を使用する
    #[cfg(not(windows))]
    {
        // Unix 系環境では /tmp 配下をインストールルートとして使用する
        PathBuf::from("/tmp/DevPortal")
    }
}

// Verdaccio のデータ格納ディレクトリを返す関数
// devportal_root/verdaccio に対応する
pub fn verdaccio_dir(config: &SetupConfig) -> PathBuf {
    // devportal_root に verdaccio サブディレクトリを追加する
    devportal_root(config).join("verdaccio")
}

// Verdaccio の npm パッケージインストール先ディレクトリを返す関数
// verdaccio_dir/app に対応する（npm install で verdaccio をインストールする場所）
pub fn verdaccio_app_dir(config: &SetupConfig) -> PathBuf {
    // verdaccio_dir に app サブディレクトリを追加する
    verdaccio_dir(config).join("app")
}

// Verdaccio のパッケージストレージディレクトリを返す関数
// verdaccio_dir/storage に対応する（公開パッケージを保存する場所）
pub fn verdaccio_storage_dir(config: &SetupConfig) -> PathBuf {
    // verdaccio_dir に storage サブディレクトリを追加する
    verdaccio_dir(config).join("storage")
}

// Verdaccio の設定ファイルパスを返す関数
// verdaccio_dir/config.yaml に対応する
pub fn verdaccio_config_file(config: &SetupConfig) -> PathBuf {
    // verdaccio_dir に config.yaml ファイル名を追加する
    verdaccio_dir(config).join("config.yaml")
}

// Verdaccio のログ出力ディレクトリを返す関数
// verdaccio_dir/logs に対応する
pub fn verdaccio_logs_dir(config: &SetupConfig) -> PathBuf {
    // verdaccio_dir に logs サブディレクトリを追加する
    verdaccio_dir(config).join("logs")
}

// Backstage のルートディレクトリを返す関数
// devportal_root/backstage に対応する
pub fn backstage_root(config: &SetupConfig) -> PathBuf {
    // devportal_root に backstage サブディレクトリを追加する
    devportal_root(config).join("backstage")
}

// Backstage の create-app が生成するアプリディレクトリを返す関数
// backstage_root/app に対応する（config.backstage.app_name のディレクトリ）
pub fn backstage_app_dir(config: &SetupConfig) -> PathBuf {
    // backstage_root に app サブディレクトリを追加する
    backstage_root(config).join("app")
}

// Backstage のログ出力ディレクトリを返す関数
// backstage_root/logs に対応する
pub fn backstage_logs_dir(config: &SetupConfig) -> PathBuf {
    // backstage_root に logs サブディレクトリを追加する
    backstage_root(config).join("logs")
}

// セットアップ設定ファイル（setup.toml）のパスを返す関数
// %ProgramData%\DevPortal\config\setup.toml に対応する
pub fn config_file() -> PathBuf {
    // Windows 環境では PROGRAMDATA 環境変数からパスを構築する
    #[cfg(windows)]
    {
        // PROGRAMDATA 環境変数から %ProgramData% のパスを取得する
        let program_data = std::env::var("PROGRAMDATA")
            // 環境変数が取得できない場合は C:\ProgramData をフォールバックとして使用する
            .unwrap_or_else(|_| r"C:\ProgramData".to_string());
        // %ProgramData%\DevPortal\config\setup.toml のパスを構築して返す
        PathBuf::from(program_data)
            // DevPortal ディレクトリを追加する
            .join("DevPortal")
            // config サブディレクトリを追加する
            .join("config")
            // 設定ファイル名を追加する
            .join("setup.toml")
    }
    // 非 Windows 環境（テスト・CI 用）では /tmp 配下を使用する
    #[cfg(not(windows))]
    {
        // Unix 系環境では /tmp 配下のパスを返す
        PathBuf::from("/tmp/DevPortal/config/setup.toml")
    }
}

// NSSM バイナリのキャッシュディレクトリを返す関数
// %ProgramData%\DevPortal\bin\ に対応する（マシン全体で共有されるキャッシュ）
pub fn nssm_cache_dir() -> PathBuf {
    // Windows 環境では PROGRAMDATA 環境変数からパスを構築する
    #[cfg(windows)]
    {
        // PROGRAMDATA 環境変数から %ProgramData% のパスを取得する
        let program_data = std::env::var("PROGRAMDATA")
            // 環境変数が取得できない場合は C:\ProgramData をフォールバックとして使用する
            .unwrap_or_else(|_| r"C:\ProgramData".to_string());
        // %ProgramData%\DevPortal\bin のパスを構築して返す
        PathBuf::from(program_data).join("DevPortal").join("bin")
    }
    // 非 Windows 環境（テスト・CI 用）では /tmp 配下を使用する
    #[cfg(not(windows))]
    {
        // Unix 系環境では /tmp 配下のパスを返す
        PathBuf::from("/tmp/DevPortal/bin")
    }
}

// NSSM バイナリのキャッシュパス（nssm.exe のフルパス）を返す関数
// %ProgramData%\DevPortal\bin\nssm.exe に対応する
pub fn nssm_cache_path() -> PathBuf {
    // キャッシュディレクトリに nssm.exe を追加して返す
    nssm_cache_dir().join("nssm.exe")
}

// nssm.exe のパスを解決して返す関数
// 優先順位:
//   1. DEVPORTAL_NSSM_PATH 環境変数
//   2. %ProgramData%\DevPortal\bin\nssm.exe（ランタイムキャッシュ）
// どちらにも存在しなければ Err(SetupError::NssmNotFound(searched)) を返す
// （呼び出し元は nssm_fetcher::ensure_nssm() でフォールバック取得することを想定）
pub fn resolve_nssm_path() -> Result<PathBuf, SetupError> {
    // DEVPORTAL_NSSM_PATH 環境変数を確認する（最優先）
    if let Ok(env_path) = std::env::var("DEVPORTAL_NSSM_PATH") {
        // 環境変数で指定されたパスを PathBuf に変換する
        let path = PathBuf::from(&env_path);
        // 指定されたパスが実際に存在するか確認する
        if path.exists() {
            // 存在する場合はそのパスを返す
            return Ok(path);
        }
        // 存在しない場合は環境変数の値を含む NssmNotFound エラーを返す
        return Err(SetupError::NssmNotFound(vec![path]));
    }

    // %ProgramData%\DevPortal\bin\nssm.exe のキャッシュを確認する
    let cache = nssm_cache_path();
    // キャッシュファイルが存在する場合はそのパスを返す
    if cache.exists() {
        // キャッシュパスを返す
        return Ok(cache);
    }

    // 環境変数もキャッシュも存在しない場合は NssmNotFound エラーを返す
    // 呼び出し元は nssm_fetcher::ensure_nssm() を呼んで動的取得することを想定する
    Err(SetupError::NssmNotFound(vec![cache]))
}
