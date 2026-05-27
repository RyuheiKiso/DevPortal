// ============================================================================
// MainViewController.kt (iosMain)
// iOS から Compose UI を埋め込むためのエントリポイント
// Xcode 側 (iosApp/ContentView.swift) から `MainViewControllerKt.MainViewController()`
// として参照される
// ============================================================================

// パッケージ宣言
package com.example.kmpapp

// Compose UI を UIViewController として返すブリッジ API
import androidx.compose.ui.window.ComposeUIViewController
// Swift から参照する UIViewController
import platform.UIKit.UIViewController

/**
 * Compose UI をホストする UIViewController を生成する。
 *
 * - Swift 側からは `ComposeApp` フレームワーク経由で呼び出される。
 * - 命名規則: `MainViewControllerKt.MainViewController()` (Kt サフィックスは Kotlin の慣習)
 */
fun MainViewController(): UIViewController = ComposeUIViewController {
    // 共通 UI エントリポイント (commonMain の App())
    App()
}
