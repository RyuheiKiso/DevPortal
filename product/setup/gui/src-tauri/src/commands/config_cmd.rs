// このファイルは設定の読み込みと保存を行う Tauri コマンドを定義する
// setup.toml を経由して SetupConfig を永続化する

// shared クレートの SetupConfig をインポートする
use shared::config::SetupConfig;
// shared クレートのパスユーティリティをインポートする
use shared::paths;

// cmd_load_config: setup.toml から設定を読み込む Tauri コマンド
// ファイルが存在しない場合はデフォルト設定を返す
#[tauri::command]
pub fn cmd_load_config() -> SetupConfig {
    // 設定ファイルのパスを取得する（%ProgramData%\DevPortal\config\setup.toml 固定）
    let path = paths::config_file();
    // ファイルが存在する場合は読み込む
    if path.exists() {
        // 読み込み失敗時はデフォルト設定にフォールバックする
        SetupConfig::from_file(&path).unwrap_or_default()
    } else {
        // ファイルが存在しない場合はデフォルト設定を返す
        SetupConfig::default()
    }
}

// cmd_save_config: 設定を setup.toml に保存する Tauri コマンド
// 親ディレクトリが存在しない場合は作成する
#[tauri::command]
pub fn cmd_save_config(config: SetupConfig) -> Result<(), String> {
    // 設定ファイルのパスを取得する
    let path = paths::config_file();
    // 親ディレクトリが存在しない場合は作成する（管理者権限が必要な場合がある）
    if let Some(parent) = path.parent() {
        // 既に存在する場合もエラーにせず無視する
        let _ = std::fs::create_dir_all(parent);
    }
    // SetupConfig::save_to を呼び出して TOML 形式で書き出す
    config
        .save_to(&path)
        .map_err(|e| format!("設定ファイル保存失敗: {}", e))
}
