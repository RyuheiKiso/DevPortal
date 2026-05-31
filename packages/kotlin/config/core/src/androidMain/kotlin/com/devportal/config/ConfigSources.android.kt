package com.devportal.config

// assets / filesDir へのアクセスに使う Android のコンテキスト
import android.content.Context
// ファイル変更監視に使う FileObserver
import android.os.FileObserver
// IO 処理を IO ディスパッチャで行うためのインポート
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
// 監視を Flow として実装するためのインポート
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOf
// ファイル操作
import java.io.File

// Android 向けの設定供給元。既定層は assets、システム/ユーザー層は filesDir/config/ のファイル。
class AndroidConfigSources(
    // アプリのコンテキスト（assets と filesDir へのアクセスに使う）
    context: Context,
    // 既定設定を収めた assets 内のファイルパス
    private val defaultAssetName: String = "config/default.json",
) : ConfigSources {

    // アプリケーションコンテキストを保持する（リーク防止のため applicationContext を使う）
    private val appContext = context.applicationContext

    // 書込可能な層を置くディレクトリ（filesDir/config）
    private val configDir = File(appContext.filesDir, "config")

    // 指定層の供給元を返す。
    override fun source(layer: Layer): LayerSource = when (layer) {
        // 既定層は assets の読取専用
        Layer.DEFAULT -> AssetLayerSource(appContext, defaultAssetName)
        // システム層は filesDir/config/system.json
        Layer.SYSTEM -> AndroidFileLayerSource(File(configDir, "system.json"))
        // ユーザー層は filesDir/config/user.json
        Layer.USER -> AndroidFileLayerSource(File(configDir, "user.json"))
    }
}

// assets 内の読取専用ファイルを供給する LayerSource。
private class AssetLayerSource(
    // assets へアクセスするためのコンテキスト
    private val context: Context,
    // assets 内のファイルパス
    private val assetName: String,
) : LayerSource {
    // assets は書き込めない
    override val writable: Boolean = false

    // assets からテキストを読み込む。存在しなければ null。
    override suspend fun read(): String? = withContext(Dispatchers.IO) {
        // assets を開いて全文を読む。失敗（ファイル無し等）なら null を返す
        runCatching { context.assets.open(assetName).bufferedReader().use { it.readText() } }.getOrNull()
    }

    // assets へは書き込めないため常に失敗を返す。
    override suspend fun write(content: String): Result<Unit> =
        // 読取専用であることを示す失敗を返す
        Result.failure(IllegalStateException("assets are read-only: $assetName"))

    // assets は変更されないため監視は何も流さない。
    override fun watch(): Flow<Unit> = flowOf()
}

// filesDir 配下のファイルを読み書き・監視する LayerSource。
private class AndroidFileLayerSource(
    // 対象ファイル
    private val file: File,
) : LayerSource {
    // filesDir 配下は書込可能
    override val writable: Boolean = true

    // ファイル内容を読み込む。存在しなければ null。
    override suspend fun read(): String? = withContext(Dispatchers.IO) {
        // ファイルがある場合のみ内容を読む
        if (file.exists()) file.readText() else null
    }

    // 内容をアトミックに書き込む。
    override suspend fun write(content: String): Result<Unit> = withContext(Dispatchers.IO) {
        // 例外を Result に包んで返す
        runCatching {
            // 親ディレクトリを用意する
            file.parentFile?.mkdirs()
            // 一時ファイルに書き出す
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(content)
            // 一時ファイルを本ファイルへリネームで置き換える。失敗したら例外にする
            check(tmp.renameTo(file)) { "atomic rename failed: $file" }
        }
    }

    // FileObserver でファイル変更を監視し Flow に流す。
    override fun watch(): Flow<Unit> = callbackFlow {
        // 監視対象の親ディレクトリ。無ければ監視を終了する
        val dir = file.parentFile ?: run { close(); return@callbackFlow }
        // ディレクトリを用意する
        dir.mkdirs()
        // 対象ディレクトリの作成・更新・削除を監視する FileObserver を生成する
        @Suppress("DEPRECATION")
        val observer = object : FileObserver(dir.path, CREATE or MODIFY or DELETE) {
            // 変更イベント受信時に呼ばれる
            override fun onEvent(event: Int, path: String?) {
                // 対象ファイル名と一致する変更のみ通知する
                if (path == file.name) trySend(Unit)
            }
        }
        // 監視を開始する
        observer.startWatching()
        // Flow がキャンセルされたら監視を止める
        awaitClose { observer.stopWatching() }
    }
}
