package com.devportal.config

// IO 処理を IO ディスパッチャで行うためのインポート
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
// 監視を callbackFlow として実装するためのインポート
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
// ファイル操作（NIO）
import java.nio.file.ClosedWatchServiceException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import java.nio.file.StandardWatchEventKinds
// Path の拡張関数
import kotlin.io.path.exists
import kotlin.io.path.name
import kotlin.io.path.readText

// Desktop(JVM/Windows) 向けの設定供給元。exe と同じフォルダの config/ に3層ファイルを置く。
class DesktopConfigSources(
    // 設定ファイルを置くディレクトリ。未指定なら exe 隣の config/ を自動解決する。
    private val configDir: Path = defaultConfigDir(),
) : ConfigSources {

    // 層ごとのファイル名を解決する。
    private fun fileName(layer: Layer): String = when (layer) {
        // 既定層は default.json
        Layer.DEFAULT -> "default.json"
        // システム層は system.json
        Layer.SYSTEM -> "system.json"
        // ユーザー層は user.json
        Layer.USER -> "user.json"
    }

    // 指定層のファイルベース供給元を返す。
    override fun source(layer: Layer): LayerSource =
        // 既定層のみ読取専用、その他は書込可能とする
        FileLayerSource(configDir.resolve(fileName(layer)), writable = layer != Layer.DEFAULT)

    // exe 隣の config/ を解決する補助関数を持つ companion object。
    companion object {
        // 実行中プロセスのパスから config ディレクトリを推定する。
        fun defaultConfigDir(): Path {
            // 実行中プロセスのコマンドパス（exe）の親フォルダを基点にする。取得できなければ作業ディレクトリで代替する
            val baseDir = ProcessHandle.current().info().command()
                .map { Paths.get(it).parent }
                .orElse(Paths.get(System.getProperty("user.dir")))
            // 基点フォルダ直下の config を返す
            return baseDir.resolve("config")
        }
    }
}

// 単一ファイルを読み書き・監視する LayerSource 実装。
private class FileLayerSource(
    // 対象ファイルのパス
    private val path: Path,
    // 書き込み可能かどうか
    override val writable: Boolean,
) : LayerSource {

    // ファイル内容を読み込む。存在しなければ null。
    override suspend fun read(): String? = withContext(Dispatchers.IO) {
        // ファイルが存在する場合のみ内容を読む
        if (path.exists()) path.readText() else null
    }

    // 内容をアトミックに書き込む。
    override suspend fun write(content: String): Result<Unit> = withContext(Dispatchers.IO) {
        // 書込不可の層への書き込みは失敗として扱う
        if (!writable) {
            // 読取専用層は書けないため失敗を返す
            return@withContext Result.failure(IllegalStateException("read-only layer: $path"))
        }
        // 例外を Result に包んで返す
        runCatching {
            // 親ディレクトリが無ければ作成する
            Files.createDirectories(path.parent)
            // 一時ファイルに書き出す
            val tmp = path.resolveSibling(path.name + ".tmp")
            Files.writeString(tmp, content)
            // 一時ファイルを本ファイルへ原子的に置き換える
            Files.move(tmp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            // Result<Unit> にするため Unit を返す
            Unit
        }
    }

    // ディレクトリ監視でファイル変更を検知し Flow に流す。
    // 購読停止時に awaitClose で WatchService を確実に閉じ、ハンドルのリークを防ぐ。
    override fun watch(): Flow<Unit> = callbackFlow {
        // 監視対象の親ディレクトリ
        val dir = path.parent
        // ディレクトリが無ければ監視できないので閉じて終了する
        if (dir == null || !dir.exists()) {
            close()
            return@callbackFlow
        }
        // WatchService を生成する
        val watcher = dir.fileSystem.newWatchService()
        // 作成・更新・削除イベントを購読する
        dir.register(
            watcher,
            StandardWatchEventKinds.ENTRY_CREATE,
            StandardWatchEventKinds.ENTRY_MODIFY,
            StandardWatchEventKinds.ENTRY_DELETE,
        )
        // ブロッキングする take() を別ジョブ（IO）で回す
        val job = launch(Dispatchers.IO) {
            try {
                // ジョブが生きている間ポーリングする
                while (isActive) {
                    // 次の変更イベント群を待つ（ブロッキング）
                    val key = watcher.take()
                    // 対象ファイルに対する変更が含まれるか確認する
                    val changed = key.pollEvents().any { event ->
                        // イベントのファイル名が対象ファイルと一致するか
                        (event.context() as? Path)?.name == path.name
                    }
                    // 対象ファイルが変わっていれば通知する
                    if (changed) trySend(Unit)
                    // 監視キーを再有効化する。無効になったら監視を終える
                    if (!key.reset()) break
                }
            } catch (_: ClosedWatchServiceException) {
                // awaitClose 経由で watcher が閉じられた場合は正常終了とみなす
            }
        }
        // 購読停止時に監視ジョブと WatchService を確実に閉じる
        awaitClose {
            // WatchService を閉じる（ブロッキング中の take() を ClosedWatchServiceException で中断する）
            watcher.close()
            // 監視ジョブをキャンセルする
            job.cancel()
        }
    }
}
