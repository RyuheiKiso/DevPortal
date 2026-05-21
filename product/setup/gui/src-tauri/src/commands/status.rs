// このファイルは全コンポーネントの状態を返す Tauri コマンドを定義する
// Verdaccio と Backstage のステータスをまとめて JSON として返す

// shared クレートのコンポーネント種別を参照するためにインポートする
use shared::event::Component;
// shared クレートのエンジンファクトリ関数をインポートする
use shared::engine::engine_for;
// shared クレートのデフォルト設定をインポートする
use shared::config::SetupConfig;
// shared クレートのパスユーティリティをインポートする
use shared::paths;

// cmd_status_all: 全コンポーネントの状態を返す Tauri コマンド
// Verdaccio と Backstage それぞれの ComponentStatus を JSON 配列として返す
#[tauri::command]
pub fn cmd_status_all() -> serde_json::Value {
    // setup.toml が存在すればそこから設定を読み込み、無ければデフォルトを使用する
    let config_path = paths::config_file();
    // ユーザーが保存した install_root が反映される（カスタムパスに対応する）
    let config = if config_path.exists() {
        // 読み込み失敗時はデフォルト設定にフォールバックする
        SetupConfig::from_file(&config_path).unwrap_or_default()
    } else {
        // ファイルが存在しない場合はデフォルト設定を使用する
        SetupConfig::default()
    };

    // ステータスを格納するベクタを初期化する
    let mut statuses = Vec::new();

    // Verdaccio コンポーネントのエンジンを取得する
    let verdaccio_engine = engine_for(Component::Verdaccio);
    // Verdaccio のステータスを取得してベクタに追加する
    match verdaccio_engine.status(&config) {
        // ステータス取得成功の場合はベクタに追加する
        Ok(status) => statuses.push(status),
        // ステータス取得失敗の場合はエラー JSON を返す
        Err(e) => {
            return serde_json::json!({ "error": format!("Verdaccio ステータス取得失敗: {}", e) })
        }
    }

    // Backstage コンポーネントのエンジンを取得する
    let backstage_engine = engine_for(Component::Backstage);
    // Backstage のステータスを取得してベクタに追加する
    match backstage_engine.status(&config) {
        // ステータス取得成功の場合はベクタに追加する
        Ok(status) => statuses.push(status),
        // ステータス取得失敗の場合はエラー JSON を返す
        Err(e) => {
            return serde_json::json!({ "error": format!("Backstage ステータス取得失敗: {}", e) })
        }
    }

    // 全コンポーネントのステータスを JSON 配列に変換して返す
    serde_json::to_value(statuses).unwrap_or(serde_json::Value::Null)
}
