import type { NotificationLevel, ToastInput } from "./types.js";

// Duck-typed shape accepted from @k1s0-ts-http/core without importing it at runtime.
export interface HttpErrorLike {
  message: string;
  code?: string;
  status?: number;
  requestId?: string;
  retryable?: boolean;
}

export function isHttpErrorLike(value: unknown): value is HttpErrorLike {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.message !== "string") {
    return false;
  }
  const hasStatus = typeof candidate.status === "number";
  const hasCode = typeof candidate.code === "string";
  return hasStatus || hasCode;
}

export interface ErrorMappingEntry {
  title: string;
  level: NotificationLevel;
}

export interface FromHttpErrorOptions {
  messageResolver?: (err: HttpErrorLike) => { title?: string; message?: string };
  levelResolver?: (err: HttpErrorLike) => NotificationLevel;
  meta?: Readonly<Record<string, unknown>>;
  duration?: number;
  dedupeKey?: string;
}

export function resolveDefaultMapping(err: HttpErrorLike): ErrorMappingEntry {
  if (err.code === "NETWORK") {
    return { level: "warning", title: "ネットワーク接続を確認してください" };
  }
  if (err.code === "TIMEOUT") {
    return { level: "warning", title: "通信がタイムアウトしました" };
  }
  if (err.code === "ABORTED") {
    return { level: "info", title: "操作がキャンセルされました" };
  }
  const status = err.status;
  if (typeof status === "number" && status >= 500) {
    return { level: "error", title: "サーバーエラーが発生しました" };
  }
  if (status === 401) {
    return { level: "warning", title: "認証が必要です" };
  }
  if (status === 403) {
    return { level: "warning", title: "権限がありません" };
  }
  if (status === 404) {
    return { level: "warning", title: "リソースが見つかりません" };
  }
  if (typeof status === "number" && status >= 400) {
    return { level: "warning", title: "リクエストエラー" };
  }
  return { level: "error", title: "エラーが発生しました" };
}

export function fromHttpError(err: HttpErrorLike, options: FromHttpErrorOptions = {}): ToastInput {
  const mapped = resolveDefaultMapping(err);
  const resolved = options.messageResolver?.(err) ?? {};
  const title = resolved.title ?? mapped.title;
  const message = resolved.message ?? err.message;
  const level = options.levelResolver?.(err) ?? mapped.level;
  const baseMeta: Record<string, unknown> = {};

  if (err.requestId !== undefined) {
    baseMeta.requestId = err.requestId;
  }
  if (err.code !== undefined) {
    baseMeta.code = err.code;
  }
  if (err.status !== undefined) {
    baseMeta.status = err.status;
  }
  if (err.retryable !== undefined) {
    baseMeta.retryable = err.retryable;
  }

  const meta = {
    ...baseMeta,
    ...(options.meta ?? {}),
  };

  return {
    level,
    title,
    message,
    duration: options.duration,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
    dedupeKey: options.dedupeKey,
  };
}
