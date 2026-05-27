// ============================================================================
// Theme.kt (commonMain)
// アプリ共通テーマ (Material3 MaterialTheme のラッパー)
// ColorScheme / Typography / Shapes を切り替える単一の入り口
// ============================================================================

// パッケージ宣言
package com.example.kmpapp.ui.theme

// Composable 注釈
import androidx.compose.runtime.Composable
// Material3 提供のテーマ系 API
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme

/**
 * ライトテーマ用 ColorScheme。
 *
 * Color.kt で定義した個別色を Material3 の色トークンへマッピングする。
 */
private val LightColorScheme = lightColorScheme(
    primary = LightPrimary,
    onPrimary = LightOnPrimary,
    secondary = LightSecondary,
    onSecondary = LightOnSecondary,
    background = LightBackground,
    onBackground = LightOnBackground,
    surface = LightSurface,
    onSurface = LightOnSurface,
)

/**
 * ダークテーマ用 ColorScheme。
 */
private val DarkColorScheme = darkColorScheme(
    primary = DarkPrimary,
    onPrimary = DarkOnPrimary,
    secondary = DarkSecondary,
    onSecondary = DarkOnSecondary,
    background = DarkBackground,
    onBackground = DarkOnBackground,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
)

/**
 * アプリ共通テーマを子コンポーザブルへ適用する。
 *
 * @param useDarkTheme ダークテーマを使うかどうか (既定: システム設定を未取得のため false)
 * @param content テーマを適用したい子コンポーザブル
 */
@Composable
fun AppTheme(
    useDarkTheme: Boolean = false,
    content: @Composable () -> Unit,
) {
    // 表示モードに応じて ColorScheme を選択
    val colorScheme = if (useDarkTheme) DarkColorScheme else LightColorScheme
    // Material3 にテーマを引き渡す
    MaterialTheme(
        // 色設定
        colorScheme = colorScheme,
        // タイポグラフィ設定
        typography = AppTypography,
        // 子要素 (= アプリ本体) を内包
        content = content,
    )
}
