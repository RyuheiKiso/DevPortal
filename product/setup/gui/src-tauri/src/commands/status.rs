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
// Verdaccio と Backstage を並列で問い合わせ、ComponentStatus の JSON 配列として返す
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

    // Verdaccio と Backstage の status() を別スレッドで並列実行する（逐次だと合計待ち時間が倍になるため）
    // 各スレッドに設定のクローンを渡す（SetupConfig: Send + Clone）
    let cfg_v = config.clone();
    // Verdaccio のステータスを別スレッドで取得する
    let handle_v = std::thread::spawn(move || engine_for(Component::Verdaccio).status(&cfg_v));

    // Backstage のステータスを別スレッドで取得する（Verdaccio と並行して実行される）
    let cfg_b = config;
    let handle_b = std::thread::spawn(move || engine_for(Component::Backstage).status(&cfg_b));

    // 両スレッドの完了を待ち、結果を回収する
    // join() のパニック（thread panic）は Err として扱い、エラー JSON を返す
    let result_v = handle_v.join().unwrap_or_else(|_| {
        Err(shared::error::SetupError::Other("Verdaccio スレッドがパニックしました".into()))
    });
    let result_b = handle_b.join().unwrap_or_else(|_| {
        Err(shared::error::SetupError::Other("Backstage スレッドがパニックしました".into()))
    });

    // ステータスを格納するベクタを初期化する
    let mut statuses = Vec::new();

    // Verdaccio の結果を処理する（エラーでも Backstage の結果は捨てない）
    match result_v {
        // 取得成功の場合はベクタに追加する
        Ok(s) => statuses.push(s),
        // 取得失敗の場合はエラー JSON を返す
        Err(e) => return serde_json::json!({ "error": format!("Verdaccio ステータス取得失敗: {}", e) }),
    }

    // Backstage の結果を処理する
    match result_b {
        // 取得成功の場合はベクタに追加する
        Ok(s) => statuses.push(s),
        // 取得失敗の場合はエラー JSON を返す
        Err(e) => return serde_json::json!({ "error": format!("Backstage ステータス取得失敗: {}", e) }),
    }

    // 全コンポーネントのステータスを JSON 配列に変換して返す
    serde_json::to_value(statuses).unwrap_or(serde_json::Value::Null)
}
