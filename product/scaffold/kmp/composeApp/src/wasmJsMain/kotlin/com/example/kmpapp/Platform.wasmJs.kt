// ============================================================================
// Platform.wasmJs.kt (wasmJsMain)
// commonMain の `expect fun currentPlatform()` に対する Web (wasmJs) 実装
// ============================================================================

// パッケージ宣言
package com.example.kmpapp

// ブラウザの window オブジェクト (navigator アクセス用)
import kotlinx.browser.window

/**
 * Web (wasmJs) プラットフォーム情報を返す actual 実装。
 *
 * - navigator.userAgent からブラウザ識別子を返す。
 */
actual fun currentPlatform(): Platform = Platform(
    // 例: "Web (Mozilla/5.0 ...)"
    name = "Web (${window.navigator.userAgent})",
)
