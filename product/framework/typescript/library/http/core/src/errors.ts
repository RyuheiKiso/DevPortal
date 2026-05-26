// 型のみ参照（HttpResponse / HttpRequest）。dependency を循環させないよう type-only
import type { HttpRequest, HttpResponse } from "./types.js";

// HttpError 構築時に渡す初期化引数
export interface HttpErrorInit {
  // 人間可読のメッセージ
  message: string;
  // HTTP ステータスコード（HTTP 起因のみ）
  status?: number;
  // 分類コード（"ABORTED" / "NETWORK" / "UNKNOWN" / gRPC status 名 / "GRPC_PEER_MISSING" 等）
  code?: string;
  // リトライ可否（retry 層が参照）
  retryable: boolean;
  // 相関 ID
  requestId?: string;
  // 原因（捕捉した元エラー）
  cause?: unknown;
  // 関連するレスポンス（存在する場合）
  response?: HttpResponse;
}

// HTTP 層が throw する例外の正規化型
export class HttpError extends Error {
  // ステータスコード（HTTP 起因のみ）
  readonly status?: number;
  // 分類コード
  readonly code?: string;
  // リトライ可否（retry 層が参照する判定値）
  readonly retryable: boolean;
  // 相関 ID
  readonly requestId?: string;
  // 関連するレスポンス
  readonly response?: HttpResponse;
  // 原因（cause を独自に持つ：Error の cause と二重保持しても害は無い）
  override readonly cause?: unknown;

  // 初期化引数から各フィールドを設定
  constructor(init: HttpErrorInit) {
    // Error 標準の cause もセットして互換性を確保
    super(init.message, { cause: init.cause });
    // クラス名を明示（serialize 時の name フィールドのため）
    this.name = "HttpError";
    // 各フィールドを反映
    this.status = init.status;
    this.code = init.code;
    this.retryable = init.retryable;
    this.requestId = init.requestId;
    this.response = init.response;
    this.cause = init.cause;
  }
}

// 任意の throw 値を HttpError に正規化する
// 既存の HttpError は素通し（requestId が空なら補完）
export function normalizeError(err: unknown, req: HttpRequest): HttpError {
  // 既存 HttpError は素通し
  if (err instanceof HttpError) {
    // requestId が無ければ補完が必要
    if (err.requestId === undefined) {
      // サブクラスの場合は new HttpError で複製するとサブクラス固有フィールドが失われる
      // → 原位置で defineProperty で requestId を上書き（C-A5）
      if (err.constructor !== HttpError) {
        try {
          Object.defineProperty(err, "requestId", {
            value: req.requestId,
            writable: false,
            enumerable: true,
            configurable: true,
          });
          return err;
          /* v8 ignore next 3 */
        } catch {
          // 何らかの理由で defineProperty が失敗した場合は基底 HttpError として複製にフォールバック
        }
      }
      // 基底 HttpError なら新規生成（フィールドは元のものを引き継ぐ）
      const next = new HttpError({
        message: err.message,
        status: err.status,
        code: err.code,
        retryable: err.retryable,
        requestId: req.requestId,
        cause: err.cause,
        response: err.response,
      });
      // stack を元のエラーから引き継ぐ（throw 元のフレームを残す、B-5）
      if (err.stack !== undefined) {
        try {
          next.stack = err.stack;
          /* v8 ignore next 3 */
        } catch {
          // stack の writable が false の環境では諦める（実害なし、新 stack で続行）
        }
      }
      return next;
    }
    // 既に requestId がある場合は素通し
    return err;
  }
  // DOMException(AbortError) はキャンセル扱い（リトライ対象外）
  if (err instanceof DOMException && err.name === "AbortError") {
    return new HttpError({
      message: "request aborted",
      code: "ABORTED",
      retryable: false,
      requestId: req.requestId,
      cause: err,
    });
  }
  // DOMException(TimeoutError) はタイムアウト扱い
  // retryable=true としてリトライ判定は retry 層 (resolveEffectiveRetryPolicy / shouldRetry) に委ねる。
  // - per-attempt timeout: 次の attempt で再試行される (冪等性ガードを通過した場合のみ)
  // - total timeout: 外側 withTimeout の signal.aborted により withRetry の次イテレーションで弾かれるため、
  //   実際の再試行は発生しない (シグナル経由の中断は markRetryExhausted を経由しないが、攻撃面なし)
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return new HttpError({
      message: "request timed out",
      code: "TIMEOUT",
      retryable: true,
      requestId: req.requestId,
      cause: err,
    });
  }
  // fetch のネットワーク失敗は TypeError として上がる
  // Node 環境（undici）では cause.code に ECONNREFUSED/ECONNRESET/ETIMEDOUT 等が入る → これらのみ retryable
  // ブラウザ環境では cause が無い場合がほとんど（CORS/Mixed Content 等の永続失敗も同居）→ 安全のため非 retryable
  if (err instanceof TypeError) {
    const cause = (err as { cause?: { code?: string } }).cause;
    const code = cause?.code;
    const RETRYABLE_NET_CODES = new Set([
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "EPIPE",
      "ENETUNREACH",
      "ENOTFOUND",
    ]);
    const retryable = typeof code === "string" && RETRYABLE_NET_CODES.has(code);
    return new HttpError({
      message: err.message,
      code: "NETWORK",
      retryable,
      requestId: req.requestId,
      cause: err,
    });
  }
  // それ以外は不明エラー（リトライしない）
  const fallbackMessage =
    err !== null && typeof err === "object" && "message" in err && typeof err.message === "string"
      ? err.message
      : String(err);
  return new HttpError({
    message: fallbackMessage,
    code: "UNKNOWN",
    retryable: false,
    requestId: req.requestId,
    cause: err,
  });
}

// retry 層が参照する既定の retryable 判定
// HttpError の retryable フラグを最優先し、status がリストに含まれているかを補助判定
export function isRetryableError(
  err: unknown,
  retryableStatuses: readonly number[],
): boolean {
  // HttpError なら status 包含 or retryable=true をそのまま採用
  if (err instanceof HttpError) {
    // status が明示されており、かつ retryableStatuses に含まれていればリトライ
    if (err.status !== undefined && retryableStatuses.includes(err.status)) {
      return true;
    }
    // それ以外は retryable フラグに従う（NETWORK は true、ABORTED/UNKNOWN は false）
    return err.retryable;
  }
  // 非 HttpError は判定不能なので false（安全側）
  return false;
}
