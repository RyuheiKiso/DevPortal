package com.devportal.config

// コルーチンのテストユーティリティ
import kotlinx.coroutines.test.runTest
// フェイクの変更通知に使う SharedFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
// テスト用スキーマのシリアライズ
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
// アサーション
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// テスト用の設定スキーマ（全フィールドにデフォルト値を持つ）。
@Serializable
data class TestConfig(
    // タイムアウト秒
    val timeoutSec: Int = 0,
    // テーマ名
    val theme: String = "",
)

// インメモリで1層を表現するフェイクの LayerSource。
private class FakeLayerSource(
    // 書き込み可能かどうか
    override val writable: Boolean,
    // 保持する内容
    var content: String? = null,
) : LayerSource {
    // 変更通知を流す SharedFlow
    private val changes = MutableSharedFlow<Unit>(extraBufferCapacity = 8)
    // 現在の内容を返す
    override suspend fun read(): String? = content
    // 書込可能なら内容を更新し変更を通知する。不可なら失敗を返す。
    override suspend fun write(c: String): Result<Unit> {
        // 読取専用なら失敗を返す
        if (!writable) return Result.failure(IllegalStateException("read-only"))
        // 内容を更新する
        content = c
        // 変更を通知する
        changes.tryEmit(Unit)
        // 成功を返す
        return Result.success(Unit)
    }
    // 変更通知の Flow を返す
    override fun watch() = changes.asSharedFlow()
}

// 3層をインメモリで供給するフェイクの ConfigSources。
private class FakeConfigSources(
    // ユーザー層を書込可能にするか（書込失敗テスト用）
    userWritable: Boolean = true,
) : ConfigSources {
    // 既定層（読取専用）
    val default = FakeLayerSource(writable = false)
    // システム層（書込可能）
    val system = FakeLayerSource(writable = true)
    // ユーザー層
    val user = FakeLayerSource(writable = userWritable)
    // 層に対応する供給元を返す
    override fun source(layer: Layer): LayerSource = when (layer) {
        Layer.DEFAULT -> default
        Layer.SYSTEM -> system
        Layer.USER -> user
    }
}

// ConfigStore 本体（3層ロード・マージ・保存・書込失敗）を検証するテスト。
class ConfigStoreTest {

    // 3層が優先度順にマージされ config に反映される。
    @Test
    fun 三層がマージされてconfigに反映される() = runTest {
        // 各層に部分設定を入れる
        val sources = FakeConfigSources()
        sources.default.content = """{"timeoutSec":30,"theme":"light"}"""
        sources.system.content = """{"timeoutSec":60}"""
        sources.user.content = """{"theme":"dark"}"""
        // ストアを生成する（監視はテストのバックグラウンドスコープで回す）
        val store = ConfigStore.create<TestConfig>(sources, backgroundScope)
        // 明示的に再読込して結果を確定する
        store.reload().getOrThrow()
        // システム層で上書きされた timeoutSec を検証する
        assertEquals(60, store.config.value.timeoutSec)
        // ユーザー層で上書きされた theme を検証する
        assertEquals("dark", store.config.value.theme)
    }

    // ユーザー層への書き込みが config とファイルに反映される。
    @Test
    fun ユーザー層への書き込みが反映される() = runTest {
        // 空の供給元でストアを生成する
        val sources = FakeConfigSources()
        val store = ConfigStore.create<TestConfig>(sources, backgroundScope)
        // ユーザー層に theme=dark を保存する
        store.update(WritableScope.USER) { buildJsonObject { put("theme", "dark") } }.getOrThrow()
        // config に反映されている
        assertEquals("dark", store.config.value.theme)
        // ユーザー層ファイルにも書き込まれている
        assertTrue(sources.user.content?.contains("dark") == true)
    }

    // 書込不可の層への保存は Result.failure を返す（クラッシュしない）。
    @Test
    fun 書込不可の層はResult失敗を返す() = runTest {
        // ユーザー層を読取専用にした供給元でストアを生成する
        val store = ConfigStore.create<TestConfig>(FakeConfigSources(userWritable = false), backgroundScope)
        // ユーザー層への書き込みを試みる
        val result = store.update(WritableScope.USER) { buildJsonObject { put("theme", "dark") } }
        // 失敗が返ることを検証する
        assertTrue(result.isFailure)
    }
}
