// Compose の UI テスト API は experimental のためファイル単位でオプトインする
@file:OptIn(ExperimentalTestApi::class)

package com.devportal.config.ui

// Compose UI テストのユーティリティ
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
// core への依存
import com.devportal.config.ConfigStore
import com.devportal.config.WritableScope
// フェイクストアで使う Flow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
// テスト用スキーマ
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
// アサーション
import kotlin.test.Test
import kotlin.test.assertTrue

// UI テスト用の設定スキーマ。
@Serializable
data class UiTestConfig(
    // 文字列フィールド（テキスト入力になる）
    val theme: String = "light",
    // @ConfigLabel 付きの真偽値（スイッチ行のラベルに使われる）
    @ConfigLabel("有効化") val enabled: Boolean = false,
    // ネスト（セクション見出しになる）
    val nested: NestedConfig = NestedConfig(),
)

// ネストした設定スキーマ。
@Serializable
data class NestedConfig(
    // 整数フィールド
    val count: Int = 0,
)

// ConfigStore のフェイク実装。固定値を返し、保存内容を記録する。
private class FakeStore(initial: UiTestConfig) : ConfigStore<UiTestConfig> {
    // 固定のマージ済み設定
    override val config: StateFlow<UiTestConfig> = MutableStateFlow(initial).asStateFlow()
    // エラーは流さない
    override val errors: Flow<Throwable> = MutableSharedFlow()
    // 直近に保存された内容（検証用）
    var lastUpdate: JsonObject? = null
    // 変換結果を記録して成功を返す
    override suspend fun update(scope: WritableScope, transform: (JsonObject) -> JsonObject): Result<Unit> {
        // 変換関数を空オブジェクトに適用して結果を記録する
        lastUpdate = transform(JsonObject(emptyMap()))
        // 成功を返す
        return Result.success(Unit)
    }
    // 再読込は何もせず成功を返す
    override suspend fun reload(): Result<Unit> = Result.success(Unit)
}

// ConfigScreen（自動生成フォーム）の表示と操作を検証する UI テスト。
class ConfigScreenTest {

    // スキーマのラベル・フィールド・セクション・ボタンが表示される。
    @Test
    fun フォームの要素が表示される() = runComposeUiTest {
        // 固定値のフェイクストアで画面を構成する
        val store = FakeStore(UiTestConfig())
        setContent {
            ConfigScreenContent(store, UiTestConfig.serializer(), WritableScope.USER)
        }
        // @ConfigLabel のラベルが表示される
        onNodeWithText("有効化").assertExists()
        // ネストはセクション見出しとして表示される
        onNodeWithText("nested").assertExists()
        // 操作ボタンが表示される
        onNodeWithText("適用").assertExists()
        onNodeWithText("デフォルトに戻す").assertExists()
    }

    // 「適用」ボタンを押すと保存（update）が呼ばれる。
    @Test
    fun 適用ボタンで保存が呼ばれる() = runComposeUiTest {
        // フェイクストアで画面を構成する
        val store = FakeStore(UiTestConfig())
        setContent {
            ConfigScreenContent(store, UiTestConfig.serializer(), WritableScope.USER)
        }
        // 「適用」ボタンをクリックする
        onNodeWithText("適用").performClick()
        // 保存が呼ばれる（lastUpdate が設定される）まで待つ
        waitUntil { store.lastUpdate != null }
        // 保存が呼ばれたことを検証する
        assertTrue(store.lastUpdate != null)
    }
}
