// retry 層に必要な型をインポート
import type { RetryPolicy } from "./types.js";
// retryable 判定とエラー型
import { isRetryableError } from "./errors.js";

// 既定リトライ対象ステータス（HTTP 標準的な 429/5xx + 408/425）
export const DEFAULT_RETRYABLE_STATUSES: readonly number[] = [
  408, 425, 429, 500, 502, 503, 504,
];

// RetryPolicy の部分指定に既定値を埋めて完成形にするヘルパ
export function mergeRetryDefaults(
  partial: Partial<RetryPolicy> | undefined,
): Required<Pick<RetryPolicy, "maxRetries" | "backoffBaseMs" | "backoffMaxMs" | "jitter" | "retryableStatuses">> &
  Pick<RetryPolicy, "shouldRetry" | "random"> {
  return {
    // 最大リトライ回数（既定 3）
    maxRetries: partial?.maxRetries ?? 3,
    // 指数バックオフ基底（既定 200ms）
    backoffBaseMs: partial?.backoffBaseMs ?? 200,
    // バックオフ上限（既定 10s）
    backoffMaxMs: partial?.backoffMaxMs ?? 10_000,
    // ジッタ戦略（既定 full）
    jitter: partial?.jitter ?? "full",
    // 既定リトライ対象ステータス
    retryableStatuses: partial?.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES,
    // ユーザ判定関数（任意）
    shouldRetry: partial?.shouldRetry,
    // 乱数源（任意）
    random: partial?.random,
  };
}

// signal を尊重しつつ ms 待機するヘルパ（abort 時は即時 reject）
export function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  // 待機 0 以下なら即座に解決（タイマー登録不要）
  if (ms <= 0) {
    return Promise.resolve();
  }
  // signal が既に abort 済みなら待たずに reject
  if (signal !== undefined && signal.aborted) {
    // signal.reason は AbortController.abort() で自動付与されるので右辺は到達不能の安全網
    /* v8 ignore next */
    return Promise.reject(signal.reason ?? new DOMException("aborted", "AbortError"));
  }
  // setTimeout と addEventListener を組み合わせた Promise を返す
  return new Promise<void>((resolve, reject) => {
    // タイマー本体（指定 ms 経過で解決）
    const timer = setTimeout(() => {
      // 解決前に signal リスナを解除（リーク防止）
      if (signal !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);
    // abort ハンドラ（タイマーをキャンセルして reject）
    const onAbort = (): void => {
      clearTimeout(timer);
      // signal は購読対象なので必ず存在し reason も付くため、右辺は到達不能の安全網
      /* v8 ignore next */
      reject(signal?.reason ?? new DOMException("aborted", "AbortError"));
    };
    // signal がある場合のみ購読
    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

// withRetry: attempt 関数を policy に従って繰り返し呼び出す
// while(true) で TS の到達可能性解析を活用し、最終 throw を不要にする
export async function withRetry<T>(
  policy: ReturnType<typeof mergeRetryDefaults>,
  signal: AbortSignal | undefined,
  attempt: (attemptIndex: number) => Promise<T>,
): Promise<T> {
  // 0 オリジンの試行カウンタ
  let i = 0;
  // 必ず return か throw で抜ける（lint への明示）
  while (true) {
    // 試行直前に signal を確認（既に abort なら即時中断）
    if (signal !== undefined && signal.aborted) {
      // signal.reason は AbortController.abort() で自動付与されるので右辺は到達不能の安全網
      /* v8 ignore next */
      throw signal.reason ?? new DOMException("aborted", "AbortError");
    }
    try {
      // 試行を実行（成功すればそのまま返す）
      return await attempt(i);
    } catch (err) {
      // shouldRetry がある場合はそれを優先、無ければ既定の status 判定
      const shouldRetryDecision =
        policy.shouldRetry !== undefined
          ? policy.shouldRetry(err, i)
          : isRetryableError(err, policy.retryableStatuses);
      // 最大回数に達した or リトライ不可なら即 throw
      if (!shouldRetryDecision || i === policy.maxRetries) {
        throw err;
      }
      // 指数バックオフ（base * 2^i）を上限でクリップ
      const exp = Math.min(
        policy.backoffMaxMs,
        policy.backoffBaseMs * Math.pow(2, i),
      );
      // ジッタ戦略に従って待機時間を決定
      const random = policy.random ?? Math.random;
      const wait = policy.jitter === "none" ? exp : exp * random();
      // 待機（signal abort で即時中断）
      await sleep(wait, signal);
      // 試行カウンタを進める
      i++;
    }
  }
}
