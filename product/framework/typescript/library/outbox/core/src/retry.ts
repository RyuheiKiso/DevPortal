// RetryPolicy / OutboxEntry 型を取り込み
import type { OutboxEntry, RetryPolicy } from "./types.js";
// OutboxError の retryable フラグ判定用
import { isOutboxError } from "./errors.js";

// RetryPolicy の既定値
export const DEFAULT_RETRY_POLICY: Required<Pick<
  RetryPolicy,
  "maxRetries" | "backoffBaseMs" | "backoffMaxMs" | "jitter"
>> = {
  // 既定の最大リトライ回数 (作成時 maxAttempts = 6 となる)
  maxRetries: 5,
  // 既定の指数バックオフ基底 (500ms)
  backoffBaseMs: 500,
  // 既定のバックオフ上限 (60s)
  backoffMaxMs: 60_000,
  // 既定のジッタ戦略 (full jitter)
  jitter: "full",
};

// 部分指定の RetryPolicy に既定値を埋めて完成形にする
export function mergeRetryPolicy(
  // ユーザー指定 (省略可)
  partial: Partial<RetryPolicy> | undefined,
): RetryPolicy {
  // 既定値とマージ (random / shouldRetry は undefined ならそのまま undefined)
  return {
    maxRetries: partial?.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
    backoffBaseMs: partial?.backoffBaseMs ?? DEFAULT_RETRY_POLICY.backoffBaseMs,
    backoffMaxMs: partial?.backoffMaxMs ?? DEFAULT_RETRY_POLICY.backoffMaxMs,
    jitter: partial?.jitter ?? DEFAULT_RETRY_POLICY.jitter,
    random: partial?.random,
    shouldRetry: partial?.shouldRetry,
  };
}

// 指数バックオフを計算する純粋関数
// attempt: 失敗回数 (0 起点。0 回失敗時の次回試行は base*2^0 = base)
// 戻り値: 次回試行までの待機 ms (1 以上の整数)
export function computeBackoff(attempt: number, policy: RetryPolicy): number {
  // 2^attempt をかけて指数的に伸ばし、上限でクリップ
  const exp = Math.min(policy.backoffMaxMs, policy.backoffBaseMs * 2 ** attempt);
  // jitter="none" ならそのまま返す
  if (policy.jitter === "none") {
    // 最小 1ms を保証 (0ms 待機を避けてイベントループを 1 tick 消費させる)
    return Math.max(1, exp);
  }
  // full jitter: 0..exp の一様乱数 (random 注入があれば優先)
  const random = (policy.random ?? Math.random)();
  // 1ms 未満になるのを防ぐ
  return Math.max(1, Math.floor(exp * random));
}

// 失敗時に retry すべきか判定する
// - policy.shouldRetry が指定されていればそれを優先
// - OutboxError({ retryable: false }) なら false
// - attemptCount + 1 >= maxAttempts なら false (試行回数枯渇)
// - それ以外は true
export function shouldRetryEntry<T>(
  // 対象エントリ
  entry: OutboxEntry<T>,
  // 直近の失敗例外
  err: unknown,
  // RetryPolicy (mergeRetryPolicy 適用済み)
  policy: RetryPolicy,
): boolean {
  // ユーザー定義の判定関数があれば最優先で使う
  if (policy.shouldRetry !== undefined) {
    return policy.shouldRetry(err, entry.attemptCount);
  }
  // OutboxError で retryable=false なら即 false
  if (isOutboxError(err) && err.retryable === false) {
    return false;
  }
  // 試行回数の上限に達するなら false
  // attemptCount は今回の失敗試行も含めた現在値 (publish 中に +1 されたもの)
  if (entry.attemptCount >= entry.maxAttempts) {
    return false;
  }
  // 既定は true
  return true;
}
