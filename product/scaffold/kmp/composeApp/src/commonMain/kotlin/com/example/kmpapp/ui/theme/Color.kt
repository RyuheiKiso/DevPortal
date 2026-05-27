// ============================================================================
// Color.kt (commonMain)
// アプリ全体で使用する色定義 (Material3 ColorScheme の入力値)
// 配色を変えたい場合は、ここの定数のみ書き換える
// ============================================================================

// パッケージ宣言
package com.example.kmpapp.ui.theme

// Compose 標準の Color クラス
import androidx.compose.ui.graphics.Color

// --- ライトテーマ用カラー ---------------------------------------------------
// プライマリ色 (主要なボタン・強調)
val LightPrimary = Color(0xFF006C4C)
// プライマリ色の上に置くコンテンツ色 (テキスト等)
val LightOnPrimary = Color(0xFFFFFFFF)
// セカンダリ色 (副次的アクセント)
val LightSecondary = Color(0xFF4C6358)
// セカンダリ色の上のコンテンツ色
val LightOnSecondary = Color(0xFFFFFFFF)
// 背景色
val LightBackground = Color(0xFFFBFDF8)
// 背景の上のコンテンツ色
val LightOnBackground = Color(0xFF191C1A)
// 表面 (Card 等) の色
val LightSurface = Color(0xFFFBFDF8)
// 表面の上のコンテンツ色
val LightOnSurface = Color(0xFF191C1A)

// --- ダークテーマ用カラー ---------------------------------------------------
// プライマリ色 (主要なボタン・強調)
val DarkPrimary = Color(0xFF6BDBAE)
// プライマリ色の上に置くコンテンツ色 (テキスト等)
val DarkOnPrimary = Color(0xFF003826)
// セカンダリ色 (副次的アクセント)
val DarkSecondary = Color(0xFFB3CCBE)
// セカンダリ色の上のコンテンツ色
val DarkOnSecondary = Color(0xFF1F352B)
// 背景色
val DarkBackground = Color(0xFF191C1A)
// 背景の上のコンテンツ色
val DarkOnBackground = Color(0xFFE1E3DE)
// 表面 (Card 等) の色
val DarkSurface = Color(0xFF191C1A)
// 表面の上のコンテンツ色
val DarkOnSurface = Color(0xFFE1E3DE)
