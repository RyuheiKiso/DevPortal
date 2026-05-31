package com.devportal.config

// JSON のオブジェクト型を扱うためのインポート
import kotlinx.serialization.json.JsonObject

// 2つの JsonObject をディープマージする。
// override が base を上書きするが、双方がオブジェクトのキーは再帰的にマージし、
// 配列・スカラー・型不一致は override の値で丸ごと置き換える。
internal fun deepMerge(base: JsonObject, override: JsonObject): JsonObject {
    // base の内容を変更可能なマップにコピーする
    val merged = base.toMutableMap()
    // override の各エントリを順に適用する
    for ((key, overrideValue) in override) {
        // base 側の同じキーの現在値を取得する
        val baseValue = merged[key]
        // 双方がオブジェクトなら再帰マージ、そうでなければ置換する
        merged[key] = if (baseValue is JsonObject && overrideValue is JsonObject) {
            // ネストしたオブジェクトはキー単位で再帰的にマージする
            deepMerge(baseValue, overrideValue)
        } else {
            // それ以外は override の値で置き換える（配列は丸ごと置換）
            overrideValue
        }
    }
    // 不変の JsonObject として返す
    return JsonObject(merged)
}

// 複数の層を優先度の低い順にディープマージして1つの JsonObject にまとめる。
internal fun mergeLayers(layers: List<JsonObject>): JsonObject =
    // 空オブジェクトを起点に、各層を順に重ねていく
    layers.fold(JsonObject(emptyMap())) { acc, layer -> deepMerge(acc, layer) }
