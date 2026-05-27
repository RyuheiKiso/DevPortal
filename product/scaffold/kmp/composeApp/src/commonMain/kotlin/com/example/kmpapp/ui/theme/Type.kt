// ============================================================================
// Type.kt (commonMain)
// アプリ全体のタイポグラフィ定義 (Material3 Typography)
// フォントを変えたい場合は、ここで FontFamily を差し替える
// ============================================================================

// パッケージ宣言
package com.example.kmpapp.ui.theme

// Material3 Typography 構造体
import androidx.compose.material3.Typography
// テキストスタイル (フォントサイズ・行高など)
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
// Sp 単位 (フォントサイズ専用単位)
import androidx.compose.ui.unit.sp

/**
 * アプリ標準の Typography 定義。
 *
 * - Material3 標準スタイルを上書きするための最小例。
 * - カスタムフォントを使う場合は FontFamily 引数を変更する。
 */
val AppTypography: Typography = Typography(
    // 大見出し (画面トップタイトル等)
    headlineMedium = TextStyle(
        // 既定の Sans-Serif (各 OS の規定フォント)
        fontFamily = FontFamily.SansSerif,
        // やや太字
        fontWeight = FontWeight.SemiBold,
        // フォントサイズ
        fontSize = 24.sp,
        // 行の高さ
        lineHeight = 32.sp,
        // 文字間隔
        letterSpacing = 0.sp,
    ),
    // 本文 (大)
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.5.sp,
    ),
    // ボタンや小さなラベル用
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
    ),
)
