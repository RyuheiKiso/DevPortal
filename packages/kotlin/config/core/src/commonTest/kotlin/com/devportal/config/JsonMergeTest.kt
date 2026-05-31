package com.devportal.config

// JSON DSL とプリミティブの構築に使う
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
// テスト用アサーション
import kotlin.test.Test
import kotlin.test.assertEquals

// deepMerge / mergeLayers のマージ規則（README セクション4）を検証するテスト。
class JsonMergeTest {

    // スカラー値は上位層で置換される。
    @Test
    fun スカラーは上位層で置換される() {
        // 下位層の値
        val base = buildJsonObject { put("theme", "light") }
        // 上位層の値
        val override = buildJsonObject { put("theme", "dark") }
        // マージ結果は上位層の値になる
        assertEquals(JsonPrimitive("dark"), deepMerge(base, override)["theme"])
    }

    // 上位層に無いキーは下位層の値が保持される。
    @Test
    fun 上位に無いキーは下位を保持する() {
        // 下位層に timeoutSec を持たせる
        val base = buildJsonObject { put("timeoutSec", 30) }
        // 上位層は別キーのみ
        val override = buildJsonObject { put("theme", "dark") }
        // マージ後も timeoutSec は保持される
        assertEquals(JsonPrimitive(30), deepMerge(base, override)["timeoutSec"])
    }

    // ネストしたオブジェクトはキー単位で再帰マージされる。
    @Test
    fun ネストはキー単位で再帰マージされる() {
        // 下位層: api.baseUrl と api.timeoutSec
        val base = buildJsonObject {
            putJsonObject("api") {
                put("baseUrl", "https://localhost")
                put("timeoutSec", 30)
            }
        }
        // 上位層: api.baseUrl だけ上書き
        val override = buildJsonObject {
            putJsonObject("api") {
                put("baseUrl", "https://corp.internal")
            }
        }
        // マージ結果: baseUrl は上書き、timeoutSec は保持
        val api = deepMerge(base, override)["api"] as JsonObject
        assertEquals(JsonPrimitive("https://corp.internal"), api["baseUrl"])
        assertEquals(JsonPrimitive(30), api["timeoutSec"])
    }

    // 配列は再帰せず丸ごと置換される。
    @Test
    fun 配列は丸ごと置換される() {
        // 下位層の配列
        val base = buildJsonObject { put("tags", buildJsonArray { add(JsonPrimitive("a")); add(JsonPrimitive("b")) }) }
        // 上位層の配列
        val override = buildJsonObject { put("tags", buildJsonArray { add(JsonPrimitive("c")) }) }
        // マージ結果は上位層の配列で置き換わる
        val expected = buildJsonArray { add(JsonPrimitive("c")) }
        assertEquals(expected, deepMerge(base, override)["tags"])
    }

    // キーが存在すれば null でも上書きされる。
    @Test
    fun nullでも上書きされる() {
        // 下位層に値あり
        val base = buildJsonObject { put("authToken", "secret") }
        // 上位層で null に上書き
        val override = buildJsonObject { put("authToken", JsonNull) }
        // マージ結果は JsonNull になる
        assertEquals(JsonNull, deepMerge(base, override)["authToken"])
    }

    // 3層をマージすると README の例（timeoutSec=60, theme=dark）になる。
    @Test
    fun 三層マージはREADMEの例どおりになる() {
        // 既定層
        val default = buildJsonObject { put("timeoutSec", 30); put("theme", "light") }
        // システム層（timeoutSec を上書き）
        val system = buildJsonObject { put("timeoutSec", 60); put("theme", "light") }
        // ユーザー層（theme を上書き）
        val user = buildJsonObject { put("theme", "dark") }
        // 低い順にマージする
        val merged = mergeLayers(listOf(default, system, user))
        // 期待結果を検証する
        assertEquals(JsonPrimitive(60), merged["timeoutSec"])
        assertEquals(JsonPrimitive("dark"), merged["theme"])
    }
}
