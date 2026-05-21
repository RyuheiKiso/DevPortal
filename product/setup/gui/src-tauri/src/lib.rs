// このファイルは Tauri アプリのライブラリエントリポイントを定義する
// コマンドの登録と Tauri ビルダーの初期化を行う

// commands ディレクトリ配下の全サブモジュールを宣言する
mod commands;

// shared クレートの greeting 関数を取り込む
use shared::greeting;

// フロントエンドから invoke("greet") で呼び出される Tauri コマンド（既存）
#[tauri::command]
fn greet() -> String {
    // shared::greeting() の静的文字列を String に変換して返す
    greeting().to_string()
}

// モバイルビルド時はこの関数がエントリポイントとなる
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Tauri アプリのビルダーを初期化する
    tauri::Builder::default()
        // フォルダ選択ダイアログを有効化するプラグインを登録する
        .plugin(tauri_plugin_dialog::init())
        // フロントから呼び出せるコマンドとして全コマンドを登録する
        .invoke_handler(tauri::generate_handler![
            // 既存の greet コマンドを登録する
            greet,
            // 前提条件チェックコマンドを登録する
            commands::prereq::cmd_prereq_check,
            // 全コンポーネントステータス取得コマンドを登録する
            commands::status::cmd_status_all,
            // インストールコマンドを登録する
            commands::install::cmd_install,
            // アンインストールコマンドを登録する
            commands::uninstall::cmd_uninstall,
            // サービス操作コマンドを登録する
            commands::service::cmd_service_action,
            // ログフォルダを開くコマンドを登録する
            commands::elevate::cmd_open_logs,
            // 設定読み込みコマンドを登録する
            commands::config_cmd::cmd_load_config,
            // 設定保存コマンドを登録する
            commands::config_cmd::cmd_save_config,
        ])
        // tauri.conf.json などの設定を取り込んでアプリを起動する
        .run(tauri::generate_context!())
        // 起動に失敗した場合のエラーメッセージ
        .expect("error while running tauri application");
}
