// このファイルのパッケージ
package ${{ values.package_name }}

// ウィンドウの初期サイズに使う DpSize
import androidx.compose.ui.unit.DpSize
// dp 単位
import androidx.compose.ui.unit.dp
// デスクトップウィンドウ
import androidx.compose.ui.window.Window
// デスクトップアプリのエントリ関数
import androidx.compose.ui.window.application
// ウィンドウ状態（サイズ等）を記憶する関数
import androidx.compose.ui.window.rememberWindowState

// デスクトップ（Windows など）アプリのエントリポイント
fun main() = application {
    // ウィンドウの状態（初期サイズ）を記憶する
    val windowState = rememberWindowState(size = DpSize(960.dp, 640.dp))

    // アプリのメインウィンドウを表示する
    Window(
        // 閉じる操作でアプリを終了する
        onCloseRequest = ::exitApplication,
        // 記憶したウィンドウ状態を適用する
        state = windowState,
        // ウィンドウのタイトル
        title = "${{ values.app_title }}",
    ) {
        // 共通の App を描画する
        App()
    }
}
