// shared クレートの greeting 関数を取り込む
use shared::greeting;

// フロントエンドから invoke("greet") で呼び出される Tauri コマンド
#[tauri::command]
fn greet() -> String {
    // shared::greeting() の静的文字列を String に変換して返す
    greeting().to_string()
}

// モバイルビルド時はこの関数がエントリポイントとなる
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Tauri アプリのビルダーを初期化
    tauri::Builder::default()
        // フロントから呼び出せるコマンドとして greet を登録
        .invoke_handler(tauri::generate_handler![greet])
        // tauri.conf.json などの設定を取り込んでアプリを起動
        .run(tauri::generate_context!())
        // 起動に失敗した場合のエラーメッセージ
        .expect("error while running tauri application");
}
