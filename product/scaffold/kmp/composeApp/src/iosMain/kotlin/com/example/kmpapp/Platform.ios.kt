// ============================================================================
// Platform.ios.kt (iosMain)
// commonMain の `expect fun currentPlatform()` に対する iOS 実装
// ============================================================================

// パッケージ宣言
package com.example.kmpapp

// iOS デバイス情報を取得する UIKit API
import platform.UIKit.UIDevice

/**
 * iOS プラットフォーム情報を返す actual 実装。
 *
 * - UIDevice からシステム名 (例: "iOS") とバージョンを取得する。
 */
actual fun currentPlatform(): Platform = Platform(
    // 例: "iOS 17.5"
    name = "${UIDevice.currentDevice.systemName()} ${UIDevice.currentDevice.systemVersion}",
)
