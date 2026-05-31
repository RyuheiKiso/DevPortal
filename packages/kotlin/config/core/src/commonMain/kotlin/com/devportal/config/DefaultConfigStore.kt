package com.devportal.config

// コルーチンスコープと起動
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
// 非致命的エラー通知に使う SharedFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
// 内部可変／公開用の StateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
// 複数の監視 Flow を1つに統合する
import kotlinx.coroutines.flow.merge
// 書き込み・再読込を直列化するためのミューテックス
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
// シリアライザと JSON 処理
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

// ConfigStore<T> の既定実装。3層を読み込み・監視し、マージ結果を T にデコードして公開する。
// public inline な create() から生成するため @PublishedApi internal にしている。
@PublishedApi
internal class DefaultConfigStore<T> @PublishedApi internal constructor(
    // T のシリアライザ（デコードに使う）
    private val serializer: KSerializer<T>,
    // プラットフォーム別のファイル供給元
    private val sources: ConfigSources,
    // 監視・再読込を回すコルーチンスコープ
    private val coroutineScope: CoroutineScope,
    // JSON 設定
    private val json: Json,
) : ConfigStore<T> {

    // 書き込みの直列化に使うミューテックス（同時書込を防ぐ）
    private val writeMutex = Mutex()

    // 再読込の直列化に使うミューテックス（並行 reload による競合を防ぐ）
    private val reloadMutex = Mutex()

    // 非致命的エラーを通知する内部 SharedFlow（バッファを持たせ tryEmit を成立させる）
    private val _errors = MutableSharedFlow<Throwable>(extraBufferCapacity = 16)

    // 公開用の読み取り専用エラー Flow。
    override val errors: Flow<Throwable> = _errors.asSharedFlow()

    // 現在のマージ済み設定を保持する内部 StateFlow。初期値は空設定をデコードしたもの。
    private val _config = MutableStateFlow(initialConfig())

    // 公開用の読み取り専用 StateFlow。
    override val config: StateFlow<T> = _config.asStateFlow()

    // 初期化時に一度ロードし、各層の変更監視を開始する。
    init {
        // 起動時の初回ロードを実行する（結果は購読者が errors で受け取れる）
        coroutineScope.launch { reload() }
        // 全層の変更通知をまとめて購読し、変更があれば再ロードする
        coroutineScope.launch {
            // 既定・システム・ユーザーの監視 Flow を1つに統合する
            merge(
                sources.source(Layer.DEFAULT).watch(),
                sources.source(Layer.SYSTEM).watch(),
                sources.source(Layer.USER).watch(),
            ).collect {
                // いずれかの層が変わったら全層を再マージする
                reload()
            }
        }
    }

    // 空の設定から初期値を組み立てる。スキーマの全フィールドにデフォルト値が無いと失敗するため、
    // その場合は原因が分かる例外メッセージに変換して投げる。
    // serialName（Experimental API）をエラーメッセージに使うためオプトインする。
    @OptIn(ExperimentalSerializationApi::class)
    private fun initialConfig(): T =
        // 空オブジェクトからデコードを試みる
        runCatching { decode(JsonObject(emptyMap())) }
            // 失敗時はスキーマ要件違反として分かりやすい例外に変換する
            .getOrElse { error ->
                throw IllegalArgumentException(
                    "スキーマ \"${serializer.descriptor.serialName}\" は空の設定からデコードできません。" +
                        "全フィールドにデフォルト値を持たせてください。",
                    error,
                )
            }

    // 全層を読み込み、マージして T にデコードし、StateFlow を更新する。
    // デコード失敗時は警告ログとエラー通知を行い、直前の有効値を維持して Result.failure を返す。
    override suspend fun reload(): Result<Unit> = reloadMutex.withLock {
        // 優先度の低い順に各層の JsonObject を読み込む
        val layers = Layer.entries.map { layer -> readLayer(layer) }
        // 3層をディープマージする
        val merged = mergeLayers(layers)
        // マージ結果を T にデコードし、結果に応じて反映・通知する
        runCatching { decode(merged) }
            // 成功時のみ StateFlow を更新する
            .onSuccess { decoded -> _config.value = decoded }
            // 失敗時は警告ログを出し、エラー Flow に流す（StateFlow は更新しない）
            .onFailure { error ->
                logWarning("設定のデコードに失敗しました（型不一致の可能性）。直前の有効値を維持します。", error)
                _errors.tryEmit(error)
            }
            // 戻り値を Result<Unit> に変換する
            .map { }
    }

    // 指定層を読み込み・変換・保存し、再マージする。
    override suspend fun update(
        scope: WritableScope,
        transform: (JsonObject) -> JsonObject,
    ): Result<Unit> = writeMutex.withLock {
        // 書き込み対象の層を解決する
        val layer = scope.toLayer()
        // 対象層の供給元を取得する
        val source = sources.source(layer)
        // 現在の層の内容を読み込む（無ければ空オブジェクト）
        val current = readLayer(layer)
        // 利用者の変換関数を適用して新しい層内容を得る
        val updated = transform(current)
        // JSON 文字列へエンコードして書き込む
        val result = source.write(json.encodeToString(JsonObject.serializer(), updated))
        // 書き込みに成功したら再マージして反映する
        result.onSuccess { reload() }
        // 書き込みの結果（成功/失敗）をそのまま返す
        result
    }

    // 1つの層を読み込み、JsonObject として返す。
    // 存在しなければ空オブジェクト、破損・非オブジェクトなら警告ログ＋エラー通知の上で空オブジェクトとして扱う。
    private suspend fun readLayer(layer: Layer): JsonObject {
        // 層のファイル内容を読み込む。無ければ空オブジェクトを返す
        val raw = sources.source(layer).read() ?: return JsonObject(emptyMap())
        // パースに失敗、またはオブジェクトでない場合は警告して空オブジェクトとして扱う
        return runCatching {
            // ルート要素を JSON としてパースし、オブジェクトでなければ例外にする
            json.parseToJsonElement(raw) as? JsonObject ?: error("ルート要素が JSON オブジェクトではありません")
        }.getOrElse { error ->
            // 破損層を無視する旨を警告ログに出す
            logWarning("層 $layer の設定ファイルが壊れています。無視して続行します。", error)
            // エラー Flow にも通知する
            _errors.tryEmit(error)
            // 当該層を空として扱う
            JsonObject(emptyMap())
        }
    }

    // マージ済み JsonObject を型付きインスタンス T にデコードする。
    private fun decode(merged: JsonObject): T =
        // JSON 要素から T へ変換する
        json.decodeFromJsonElement(serializer, merged)
}
