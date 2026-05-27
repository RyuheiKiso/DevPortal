// ============================================================================
// Platform.kt (commonMain)
// 各プラットフォーム固有の情報を取得するための expect 宣言
// 実体 (actual) は androidMain / iosMain / desktopMain / wasmJsMain に実装する
// ============================================================================

// パッケージ宣言
package com.example.kmpapp

/**
 * プラットフォーム情報を表す軽量データ。
 *
 * - `name` には OS 名 + バージョン (例: "Android 14") を入れる想定。
 * - 必要に応じて isDarkMode 等の項目を追加していく。
 */
data class Platform(
    // プラットフォーム識別文字列 (画面に表示する用途も想定)
    val name: String,
)

/**
 * 現在実行中のプラットフォーム情報を返す。
 *
 * - `expect` 宣言により、各ターゲットで `actual` 実装を強制する。
 * - 実体は `Platform.android.kt` 等の同名関数に書く。
 */
expect fun currentPlatform(): Platform
