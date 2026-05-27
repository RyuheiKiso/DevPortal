// ============================================================================
// MainActivity.kt (androidMain)
// Android プラットフォームのエントリポイント Activity
// AndroidManifest.xml で <activity android:name=".MainActivity"> として登録される
// ============================================================================

// パッケージ宣言
package com.example.kmpapp

// Activity の基底クラス (Edge-to-Edge やシステムバー制御に対応)
import androidx.activity.ComponentActivity
// onCreate などライフサイクルの引数として渡される
import android.os.Bundle
// Activity の onCreate オーバーライド時に使用 (Compose 内容セット用)
import androidx.activity.compose.setContent

/**
 * Android のメイン Activity。
 *
 * - Compose UI を表示するため `setContent {}` で commonMain の `App()` を呼ぶ。
 * - 構成変更 (回転等) はマニフェストの configChanges で吸収する想定。
 */
class MainActivity : ComponentActivity() {
    /**
     * Activity 生成時に呼ばれるライフサイクルメソッド。
     */
    override fun onCreate(savedInstanceState: Bundle?) {
        // 基底クラスの初期化処理を呼び出す
        super.onCreate(savedInstanceState)
        // Compose のルートを設定 (commonMain で定義した App を表示)
        setContent {
            // 共通 UI エントリポイント
            App()
        }
    }
}
