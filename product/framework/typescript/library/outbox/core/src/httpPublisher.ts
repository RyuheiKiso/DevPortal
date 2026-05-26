// 公開型を取り込み
import type {
  HttpClientLike,
  HttpRequestInitLike,
  HttpResponseLike,
  OutboxEntry,
  PublishContext,
  Publisher,
} from "./types.js";
// OutboxError を生成して publisher 結果を統一表現する
import { OutboxError } from "./errors.js";

// Idempotency-Key 用のヘッダ名 (RFC draft-ietf-httpapi-idempotency-key-header)
// http/core でも同名定数を定義しているが、依存を減らすため文字列で複製する
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

// 既定のリトライ可能ステータスコード集合 (HTTP 標準的な 429 / 408 / 5xx)
export const DEFAULT_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  // タイムアウト (Request Timeout)
  408,
  // レート制限 (Too Many Requests)
  429,
  // サーバーエラー全般
  500, 502, 503, 504,
]);

// createHttpPublisher のオプション
export interface CreateHttpPublisherOptions<T> {
  // 各 entry を HTTP リクエスト init に変換する関数 (必須)
  resolveRequest: (entry: OutboxEntry<T>, ctx: PublishContext) => HttpRequestInitLike;
  // 成功判定をユーザーが上書きしたい場合 (既定: response.ok)
  treatAsSuccess?: (response: HttpResponseLike) => boolean;
  // リトライ可能判定をユーザーが上書きしたい場合 (既定: DEFAULT_RETRYABLE_STATUSES)
  treatAsRetryable?: (response: HttpResponseLike) => boolean;
}

// AbortSignal を 2 つマージして 1 つにする (どちらかが abort したら新 signal も abort)
// AbortController.any は新しい API なので、サポートされない環境向けにフォールバック実装する
// 重要: abort reason は base / extra どちら由来かを区別せず、先に abort した方の reason を採用する
// (perAttemptTimeoutMs / dispose / ユーザー指定の signal を統一的に扱うため)
function mergeAbortSignals(
  // 既存の signal (publisher 由来、必須。perAttemptTimeoutMs / dispose で abort される)
  base: AbortSignal,
  // 追加 signal (ユーザー resolveRequest が独自に渡したいケース、任意)
  extra: AbortSignal | undefined,
): AbortSignal {
  // extra がなければ base をそのまま返す (オブジェクト生成を節約)
  if (extra === undefined) {
    return base;
  }
  // AbortController.any が使える環境なら採用 (Node 22+ / モダンブラウザ)
  // 標準実装は内部で reason を正しく伝播するため、フォールバック分岐は不要
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    // 標準 API でマージ
    return anyFn([base, extra]);
  }
  // フォールバック: 新しい AbortController を作って両者の abort を中継
  const controller = new AbortController();
  // base が既に abort 済みなら即座に reason を伝播
  if (base.aborted) {
    controller.abort(base.reason);
    return controller.signal;
  }
  // extra が既に abort 済みなら即座に reason を伝播
  if (extra.aborted) {
    controller.abort(extra.reason);
    return controller.signal;
  }
  // base abort を中継 (once: true で多重 abort 呼び出しを防ぐ)
  base.addEventListener("abort", () => controller.abort(base.reason), { once: true });
  // extra abort を中継 (once: true で多重 abort 呼び出しを防ぐ)
  extra.addEventListener("abort", () => controller.abort(extra.reason), { once: true });
  // 新 signal を返す
  return controller.signal;
}

// HTTP プリセット publisher を生成する
// - Idempotency-Key を自動付与 (ユーザー指定があればそれを優先)
// - signal をマージして dispose 連動を保証
// - 成功なら解決、失敗なら OutboxError({ retryable }) を throw
export function createHttpPublisher<T>(
  // HTTP クライアント (request(init) を持つ任意実装)
  httpClient: HttpClientLike,
  // オプション (resolveRequest は必須)
  options: CreateHttpPublisherOptions<T>,
): Publisher<T> {
  // 成功判定のデフォルト (response.ok)
  const treatAsSuccess = options.treatAsSuccess ?? ((r: HttpResponseLike): boolean => r.ok);
  // リトライ可能判定のデフォルト (4xx の一部 + 5xx)
  const treatAsRetryable = options.treatAsRetryable
    ?? ((r: HttpResponseLike): boolean => DEFAULT_RETRYABLE_STATUSES.has(r.status));
  // publisher 本体
  return async (entry: OutboxEntry<T>, ctx: PublishContext): Promise<void> => {
    // ユーザーに request init を構築させる
    const init = options.resolveRequest(entry, ctx);
    // ヘッダをコピー (ユーザー指定があれば優先)
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    // Idempotency-Key が大文字小文字いずれの形でも既に設定されているか確認
    const hasIdempotencyHeader = Object.keys(headers).some(
      (k) => k.toLowerCase() === IDEMPOTENCY_KEY_HEADER.toLowerCase(),
    );
    // 未設定なら自動付与
    if (!hasIdempotencyHeader) {
      headers[IDEMPOTENCY_KEY_HEADER] = ctx.idempotencyKey;
    }
    // signal をマージ (resolveRequest が独自 signal を渡してきたら統合する)
    const signal = mergeAbortSignals(ctx.signal, init.signal);
    // 実際に HTTP 送信
    const response = await httpClient.request({
      // ユーザー指定を引き継ぎ
      ...init,
      // ヘッダはマージ済みのもの
      headers,
      // signal は統合後のもの
      signal,
    });
    // 成功と判定されればそのまま解決
    if (treatAsSuccess(response)) {
      return;
    }
    // 失敗: リトライ可能性を計算
    const retryable = treatAsRetryable(response);
    // 統一エラーを投げる (manager 側でリトライ判定される)
    throw new OutboxError({
      code: "OUTBOX_PUBLISH_FAILED",
      message: `publish failed: HTTP ${response.status}`,
      retryable,
      entryId: entry.id,
    });
  };
}
