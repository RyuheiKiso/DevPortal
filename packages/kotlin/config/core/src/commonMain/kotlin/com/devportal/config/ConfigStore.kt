package com.devportal.config

// コルーチンスコープ（監視・再読込の実行基盤）
import kotlinx.coroutines.CoroutineScope
// 非致命的エラーを通知する Flow
import kotlinx.coroutines.flow.Flow
// 設定値をリアクティブに公開するための StateFlow
import kotlinx.coroutines.flow.StateFlow
// JSON のパース設定
import kotlinx.serialization.json.Json
// 編集対象として扱う JSON オブジェクト
import kotlinx.serialization.json.JsonObject
// 型 T のシリアライザを取得するための関数
import kotlinx.serialization.serializer

// 利用者が定義したスキーマ型 T を3層マージしてリアクティブに提供する設定ストア。
interface ConfigStore<T> {
    // 現在のマージ済み設定（利用者が定義した型 T）。ファイル変更や書き込みで自動更新される。
    val config: StateFlow<T>

    // 破損ファイルや型不一致などの非致命的エラーを通知する Flow。
    // これらは例外を投げず直前の有効値を維持しつつ、ここで購読できる。
    val errors: Flow<Throwable>

    // 指定層の生 JSON を編集して保存する（保存→再マージ→config 更新）。
    // 書込不可の場合は Result.failure を返し、例外は投げない。
    suspend fun update(scope: WritableScope, transform: (JsonObject) -> JsonObject): Result<Unit>

    // 全層を手動で再読込する。デコードに失敗した場合は Result.failure を返し、直前の値を維持する。
    suspend fun reload(): Result<Unit>

    // ファクトリ拡張関数を生やすための companion object。
    companion object
}

// 利用者の型 T を指定して設定ストアを生成するファクトリ。
// reified により KSerializer<T> を内部で自動取得するため、利用者はシリアライザを明示しなくてよい。
inline fun <reified T> ConfigStore.Companion.create(
    // プラットフォーム別のファイル供給元（領域ごとのパス解決・IO・監視）
    sources: ConfigSources,
    // 初回ロードと監視を回すコルーチンスコープ（利用者がライフサイクルを制御する）
    coroutineScope: CoroutineScope,
    // JSON のパース設定（既定では未知キーを無視し、デフォルト値も書き出す）
    json: Json = Json {
        // スキーマに無いキーが来ても無視する
        ignoreUnknownKeys = true
        // データクラスのデフォルト値も JSON に書き出す
        encodeDefaults = true
    },
): ConfigStore<T> =
    // 内部実装にシリアライザ・供給元・スコープ・JSON 設定を渡してストアを構築する
    DefaultConfigStore(serializer<T>(), sources, coroutineScope, json)
