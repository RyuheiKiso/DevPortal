// リリースビルド時に Windows でコンソールウィンドウを開かないようにする属性
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// バイナリのエントリポイント
fn main() {
    // ライブラリ側の run() を呼び出してアプリを起動（モバイルと共通の入口）
    gui_lib::run()
}
