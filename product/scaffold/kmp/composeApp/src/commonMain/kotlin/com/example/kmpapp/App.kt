// ============================================================================
// App.kt
// 全プラットフォーム共通の Composable エントリポイント
// 各プラットフォーム (Android / iOS / Desktop / Web) から `App()` を呼び出す
// ============================================================================

// パッケージ宣言 (アプリ全体の名前空間)
package com.example.kmpapp

// Composable 関数を宣言するための注釈
import androidx.compose.runtime.Composable
// 状態保持 (remember / mutableStateOf) を使うためのインポート
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
// レイアウト Modifier 関連
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
// Material3 コンポーネント
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
// 共通の Modifier / 単位 / 位置揃え
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
// 共通テーマ
import com.example.kmpapp.ui.theme.AppTheme

/**
 * アプリのルート Composable 関数。
 *
 * - 各プラットフォーム (Android: setContent / iOS: ComposeUIViewController /
 *   Desktop: Window / Web: ComposeViewport) から共通で呼び出される。
 * - ここでテーマ・ナビゲーション・トップレベルのレイアウトを構築する。
 */
@Composable
fun App() {
    // アプリ共通テーマでラップ (Material3 ベース)
    AppTheme {
        // 背景色をテーマ準拠にして画面全体を覆う Surface
        Surface(
            // 親領域いっぱいに広げる
            modifier = Modifier.fillMaxSize(),
            // テーマの background をそのまま採用
            color = MaterialTheme.colorScheme.background,
        ) {
            // ボタン押下回数を保持する state (再構成をまたいで保持)
            var clickCount by remember { mutableStateOf(0) }
            // プラットフォーム情報取得 (expect/actual で各 OS の実体を返す)
            val platform = remember { currentPlatform() }

            // 縦並びレイアウト
            Column(
                // 画面全体に広げ、内側にパディングを取る
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                // 子要素を中央寄せ (水平方向)
                horizontalAlignment = Alignment.CenterHorizontally,
                // 子要素を中央寄せ (垂直方向)
                verticalArrangement = Arrangement.Center,
            ) {
                // タイトルテキスト
                Text(
                    // 表示する文字列
                    text = "Hello, Compose Multiplatform!",
                    // Material3 の Headline スタイルを適用
                    style = MaterialTheme.typography.headlineMedium,
                )
                // タイトルと本文の間の余白
                Spacer(modifier = Modifier.height(16.dp))
                // 実行中プラットフォーム名を表示
                Text(
                    // expect/actual で取得した OS 名 + バージョン
                    text = "Running on: ${platform.name}",
                    // Material3 の Body スタイルを適用
                    style = MaterialTheme.typography.bodyLarge,
                )
                // 本文とボタンの間の余白
                Spacer(modifier = Modifier.height(24.dp))
                // インクリメントボタン
                Button(
                    // クリック時にカウントを 1 増やす
                    onClick = { clickCount += 1 },
                ) {
                    // ボタン内ラベル
                    Text(text = "Clicked: $clickCount times")
                }
            }
        }
    }
}
