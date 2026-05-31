// このファイルのパッケージ
package ${{ values.package_name }}

// 子要素の縦方向の配置
import androidx.compose.foundation.layout.Arrangement
// 縦並びレイアウト
import androidx.compose.foundation.layout.Column
// 全面に広げる修飾子
import androidx.compose.foundation.layout.fillMaxSize
// 余白を付ける修飾子
import androidx.compose.foundation.layout.padding
// 安全領域（ノッチ等）を避ける余白
import androidx.compose.foundation.layout.safeContentPadding
// Material 3 のボタン
import androidx.compose.material3.Button
// Material 3 のテーマ
import androidx.compose.material3.MaterialTheme
// Material 3 のテキスト
import androidx.compose.material3.Text
// Composable であることを示すアノテーション
import androidx.compose.runtime.Composable
// by 委譲で状態を読み出す
import androidx.compose.runtime.getValue
// 可変の状態を作る
import androidx.compose.runtime.mutableStateOf
// 再コンポーズをまたいで値を保持する
import androidx.compose.runtime.remember
// by 委譲で状態を書き込む
import androidx.compose.runtime.setValue
// 子要素の横方向の整列
import androidx.compose.ui.Alignment
// 修飾子の起点
import androidx.compose.ui.Modifier
// dp 単位
import androidx.compose.ui.unit.dp
// 文字列リソースを取得する関数
import org.jetbrains.compose.resources.stringResource
// 共通プレビュー用アノテーション
import org.jetbrains.compose.ui.tooling.preview.Preview
// 生成された Res クラス
import ${{ values.package_name }}.resources.Res
// 生成された app_name 文字列リソース
import ${{ values.package_name }}.resources.app_name

// アプリ全体のルート画面（全プラットフォーム共通）
@Composable
@Preview
fun App() {
    // Material 3 テーマを適用する
    MaterialTheme {
        // ボタンのクリック回数を保持する状態
        var count by remember { mutableStateOf(0) }

        // 画面全体を縦に並べて中央に配置する
        Column(
            // 安全領域を考慮しつつ全面に広げ、内側に余白を付ける
            modifier = Modifier.safeContentPadding().fillMaxSize().padding(16.dp),
            // 子要素を縦方向中央に寄せ、間隔を空ける
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
            // 子要素を横方向中央に寄せる
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // アプリ名（文字列リソース）を見出しとして表示する
            Text(
                // 表示するテキスト（Res から取得）
                text = stringResource(Res.string.app_name),
                // 見出し用のテキストスタイル
                style = MaterialTheme.typography.headlineMedium,
            )

            // クリックするとカウントが増えるボタン
            Button(onClick = {
                // クリックされたらカウントを 1 増やす
                count++
            }) {
                // ボタン内のラベル（現在のクリック回数）
                Text(text = "Clicked: $count")
            }
        }
    }
}
