// このファイルのパッケージ
package ${{ values.package_name }}

// 状態保存に使う Bundle
import android.os.Bundle
// Compose を使う Activity の基底クラス
import androidx.activity.ComponentActivity
// Activity に Compose 画面を設定する拡張関数
import androidx.activity.compose.setContent
// システムバーまで描画を広げる関数
import androidx.activity.enableEdgeToEdge
// Composable であることを示すアノテーション
import androidx.compose.runtime.Composable
// Android Studio 用のプレビューアノテーション
import androidx.compose.ui.tooling.preview.Preview

// Android アプリのエントリポイントとなる Activity
class MainActivity : ComponentActivity() {
    // Activity 生成時に呼ばれる
    override fun onCreate(savedInstanceState: Bundle?) {
        // システムバー領域まで描画を広げる
        enableEdgeToEdge()
        // 基底クラスの初期化を行う
        super.onCreate(savedInstanceState)
        // Compose の画面を表示する
        setContent {
            // 共通の App コンポーザブルを描画する
            App()
        }
    }
}

// Android Studio でプレビュー表示するための関数
@Preview
@Composable
fun AppAndroidPreview() {
    // 共通の App を表示する
    App()
}
