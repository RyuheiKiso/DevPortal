// このファイルはフロントエンドから呼ばれる前提条件チェック Tauri コマンドを定義する
// shared::prereq::check_prereqs() を呼び出し結果を JSON Value として返す

// shared クレートの前提条件チェック関数をインポートする
use shared::prereq::check_prereqs;

// cmd_prereq_check: フロントから呼ばれる前提チェック command
// 戻り値は PrereqReport を serde_json::Value に変換した JSON オブジェクト
#[tauri::command]
pub fn cmd_prereq_check() -> serde_json::Value {
    // check_prereqs() を呼び出して全前提コマンドの存在確認を実行する
    let report = check_prereqs();
    // PrereqReport 構造体を JSON Value に変換して返す
    // 変換失敗時は null を返す（実際には失敗しない）
    serde_json::to_value(report).unwrap_or(serde_json::Value::Null)
}
