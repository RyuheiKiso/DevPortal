// ============================================================================
// Platform.android.kt (androidMain)
// commonMain の `expect fun currentPlatform()` に対する Android 実装
// ============================================================================

// パッケージ宣言 (commonMain と同一名前空間)
package com.example.kmpapp

// Android ビルドバージョン情報
import android.os.Build

/**
 * Android プラットフォーム情報を返す actual 実装。
 *
 * - Android のバージョン番号を表示用に組み立てる。
 */
actual fun currentPlatform(): Platform = Platform(
    // 例: "Android 14"
    name = "Android ${Build.VERSION.RELEASE}",
)
