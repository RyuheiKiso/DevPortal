// 連携対象は @k1s0-ts-logger/core の Logger だが、optional peer に留めるため duck typing
// 必要なメソッドだけを構造的型で要求し、本体 import は行わない
import type { CameraManager } from "./types.js";

// duck typed logger 形状（@k1s0-ts-logger/core の Logger の最小サブセット）
export interface LoggerLike {
  // 任意キーで構造化ログ（k1s0-ts-logger の info / warn / error / debug シグネチャ）
  debug: (message: string, meta?: Record<string, unknown>) => void;
  // info ログ
  info: (message: string, meta?: Record<string, unknown>) => void;
  // 警告
  warn: (message: string, meta?: Record<string, unknown>) => void;
  // エラー
  error: (message: string, meta?: Record<string, unknown>) => void;
}

// ブリッジ生成時のオプション
export interface AttachLoggerOptions {
  // ログ対象とするイベント種別の絞り込み（未指定なら全種別）
  // 例: ["error", "permission-change"] のみログするなど
  events?: ReadonlyArray<
    | "preview-start"
    | "preview-stop"
    | "photo"
    | "recording-start"
    | "recording-stop"
    | "recording-pause"
    | "recording-resume"
    | "scan"
    | "permission-change"
    | "error"
  >;
}

// manager のイベントを logger に流す購読を貼る
// 戻り値で購読解除（detach）を返す
export function attachLoggerBridge(
  manager: CameraManager,
  logger: LoggerLike,
  options: AttachLoggerOptions = {},
): () => void {
  // 絞り込みフィルタ（未指定なら null = フィルタしない）
  const filter = options.events !== undefined ? new Set(options.events) : null;
  // manager.subscribe にリスナを登録
  return manager.subscribe((event) => {
    // フィルタ対象外はスキップ
    if (filter !== null && !filter.has(event.type)) {
      return;
    }
    // event の at を必ず meta に含める
    const meta: Record<string, unknown> = { at: event.at };
    // 種別ごとに level とメッセージを切り分ける
    switch (event.type) {
      case "error":
        // CameraError 系統情報を meta に詰める
        meta.code = event.error.code;
        meta.retryable = event.error.retryable;
        meta.errorMessage = event.error.message;
        // error レベルでログ
        logger.error("[camera] error", meta);
        return;
      case "permission-change":
        // descriptor と status を記録
        meta.descriptor = event.descriptor;
        meta.status = event.status;
        // info レベル
        logger.info("[camera] permission-change", meta);
        return;
      case "preview-start":
        meta.handleId = event.handle.id;
        logger.info("[camera] preview-start", meta);
        return;
      case "preview-stop":
        meta.handleId = event.handleId;
        logger.info("[camera] preview-stop", meta);
        return;
      case "photo":
        meta.id = event.result.id;
        meta.width = event.result.width;
        meta.height = event.result.height;
        logger.info("[camera] photo", meta);
        return;
      case "recording-start":
        meta.recordingId = event.recordingId;
        logger.info("[camera] recording-start", meta);
        return;
      case "recording-stop":
        meta.id = event.result.id;
        meta.durationMs = event.result.durationMs;
        logger.info("[camera] recording-stop", meta);
        return;
      case "recording-pause":
        meta.recordingId = event.recordingId;
        logger.info("[camera] recording-pause", meta);
        return;
      case "recording-resume":
        meta.recordingId = event.recordingId;
        logger.info("[camera] recording-resume", meta);
        return;
      case "scan":
        meta.id = event.result.id;
        meta.format = event.result.format;
        logger.debug("[camera] scan", meta);
        return;
    }
  });
}
