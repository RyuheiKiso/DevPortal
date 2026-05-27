// ============================================================================
// Greeting.kt (commonMain)
// 共通ビジネスロジックの最小サンプル
// UI レイヤから切り離した「共有ロジック」の置き場所として参考にする
// ============================================================================

// パッケージ宣言
package com.example.kmpapp

/**
 * 挨拶メッセージを生成するユースケース。
 *
 * - すべてのプラットフォームで同一のロジックを共有する。
 * - 実プロジェクトではここを Repository / UseCase / ViewModel 等に拡張する。
 */
class Greeting {
    // プラットフォーム情報取得 (expect/actual の利用例)
    private val platform: Platform = currentPlatform()

    /**
     * 挨拶文字列を返す。
     *
     * @return プラットフォーム名を含む挨拶テキスト
     */
    fun greet(): String {
        // 例: "Hello, Android 14!"
        return "Hello, ${platform.name}!"
    }
}
