// ============================================================================
// Platform.desktop.kt (desktopMain)
// commonMain の `expect fun currentPlatform()` に対する Desktop (JVM) 実装
// ============================================================================

// パッケージ宣言
package com.example.kmpapp

/**
 * Desktop (JVM) プラットフォーム情報を返す actual 実装。
 *
 * - JVM システムプロパティから OS 名・バージョンを取得して整形する。
 */
actual fun currentPlatform(): Platform = Platform(
    // 例: "Desktop (Windows 11 10.0)"
    name = "Desktop (${System.getProperty("os.name")} ${System.getProperty("os.version")})",
)
