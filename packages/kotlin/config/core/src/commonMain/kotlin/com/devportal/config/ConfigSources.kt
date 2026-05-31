package com.devportal.config

// 変更監視に使う Flow のインポート
import kotlinx.coroutines.flow.Flow

// 1つの設定層に対するファイル入出力と変更監視を担う供給元。
interface LayerSource {
    // この層が書き込み可能かどうか（既定層は false）
    val writable: Boolean

    // 現在の内容を読み込む。存在しなければ null を返す。
    suspend fun read(): String?

    // 内容を書き込む。書込不可・権限不足時は Result.failure を返す。
    suspend fun write(content: String): Result<Unit>

    // この層のファイル変更を通知する Flow。変更を検知するたびに Unit を流す。
    fun watch(): Flow<Unit>
}

// 3層それぞれの LayerSource を供給するプラットフォーム別の供給元。
// 具象実装は androidMain（AndroidConfigSources）/ desktopMain（DesktopConfigSources）が提供する。
interface ConfigSources {
    // 指定した層の入出力供給元を返す。
    fun source(layer: Layer): LayerSource
}
