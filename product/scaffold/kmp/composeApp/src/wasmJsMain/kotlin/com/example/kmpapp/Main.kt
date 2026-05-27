// ============================================================================
// Main.kt (wasmJsMain)
// Web (wasmJs) ターゲットのエントリポイント
// `gradlew :composeApp:wasmJsBrowserDevelopmentRun` で開発サーバが起動する
// ============================================================================

// パッケージ宣言
package com.example.kmpapp

// Web 向けの ComposeViewport (DOM 要素に Compose ツリーをマウント)
import androidx.compose.ui.window.ComposeViewport
// Compose の実験的 API (Web は現状実験的扱い)
import androidx.compose.runtime.ExperimentalComposeApi
// ブラウザの document
import kotlinx.browser.document

/**
 * Web (wasmJs) アプリのエントリポイント。
 *
 * - HTML 上の <div id="composeApplication"> に Compose ツリーをマウントする。
 * - index.html 側で対応する DOM 要素を用意しておくこと。
 */
@OptIn(ExperimentalComposeApi::class)
fun main() {
    // DOM 要素の取得 (見つからなければ document.body にフォールバック)
    val rootElement = document.getElementById("composeApplication") ?: document.body!!
    // 取得した要素を ComposeViewport のルートとしてマウント
    ComposeViewport(rootElement) {
        // 共通 UI エントリポイント
        App()
    }
}
