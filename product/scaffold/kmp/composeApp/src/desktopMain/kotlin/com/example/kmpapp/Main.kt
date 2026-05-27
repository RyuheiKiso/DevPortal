// ============================================================================
// Main.kt (desktopMain)
// Desktop (JVM) ターゲットのエントリポイント
// `gradlew :composeApp:run` で起動する
// ============================================================================

// パッケージ宣言
package com.example.kmpapp

// Desktop 用 Window コンポーザブル
import androidx.compose.ui.window.Window
// Desktop アプリ起動関数
import androidx.compose.ui.window.application
// Window のサイズ (dp)
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.DpSize
// Window 状態 (ライフサイクルをまたいで保持)
import androidx.compose.ui.window.rememberWindowState

/**
 * Desktop アプリのエントリポイント。
 *
 * - `application {}` ブロック内で Window を生成し、内部に共通の App() を配置。
 * - build.gradle.kts の `compose.desktop.application.mainClass` で参照されている。
 */
fun main() = application {
    // Window 一つを生成して Compose UI を表示
    Window(
        // 「ウィンドウを閉じる」操作で application を終了させる
        onCloseRequest = ::exitApplication,
        // ウィンドウタイトル (タイトルバーに表示)
        title = "KMP Scaffold",
        // 初期サイズ (幅 480dp × 高さ 720dp)
        state = rememberWindowState(
            size = DpSize(480.dp, 720.dp),
        ),
    ) {
        // 共通 UI エントリポイント
        App()
    }
}
