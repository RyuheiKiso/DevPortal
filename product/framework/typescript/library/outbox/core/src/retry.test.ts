// vitest API
import { describe, expect, it } from "vitest";
// 対象モジュール
import {
  computeBackoff,
  DEFAULT_RETRY_POLICY,
  mergeRetryPolicy,
  shouldRetryEntry,
} from "./retry.js";
// 型
import type { OutboxEntry, RetryPolicy } from "./types.js";
// エラー型
import { OutboxError } from "./errors.js";

// ヘルパ: 最小エントリ
function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  // 必須フィールドを既定値で埋める
  return {
    id: "e1",
    status: "pending",
    payload: {},
    idempotencyKey: "ik",
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// ヘルパ: 既定 RetryPolicy
function basePolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  // mergeRetryPolicy で既定 + 上書き
  return mergeRetryPolicy(overrides);
}

// mergeRetryPolicy の動作
describe("mergeRetryPolicy", () => {
  // 未指定なら既定値
  it("returns defaults when partial is undefined", () => {
    // 全フィールドが既定値と一致
    const policy = mergeRetryPolicy(undefined);
    expect(policy.maxRetries).toBe(DEFAULT_RETRY_POLICY.maxRetries);
    expect(policy.backoffBaseMs).toBe(DEFAULT_RETRY_POLICY.backoffBaseMs);
    expect(policy.backoffMaxMs).toBe(DEFAULT_RETRY_POLICY.backoffMaxMs);
    expect(policy.jitter).toBe(DEFAULT_RETRY_POLICY.jitter);
    expect(policy.random).toBeUndefined();
    expect(policy.shouldRetry).toBeUndefined();
  });

  // partial 指定値が上書きする
  it("overrides specified fields", () => {
    // maxRetries だけ指定
    const policy = mergeRetryPolicy({ maxRetries: 1, jitter: "none" });
    expect(policy.maxRetries).toBe(1);
    expect(policy.jitter).toBe("none");
    // 他は既定値
    expect(policy.backoffBaseMs).toBe(DEFAULT_RETRY_POLICY.backoffBaseMs);
  });
});

// computeBackoff の動作
describe("computeBackoff", () => {
  // jitter="none" は exp をそのまま返す (1ms 以上)
  it('returns clipped exp when jitter is "none"', () => {
    // base=100, attempt=2 → 100*4 = 400
    const policy = basePolicy({ backoffBaseMs: 100, backoffMaxMs: 10_000, jitter: "none" });
    expect(computeBackoff(2, policy)).toBe(400);
  });

  // backoffMaxMs でクリップされる
  it("clips at backoffMaxMs", () => {
    // base=100, max=300, attempt=10 → 100*1024 > 300 → 300
    const policy = basePolicy({ backoffBaseMs: 100, backoffMaxMs: 300, jitter: "none" });
    expect(computeBackoff(10, policy)).toBe(300);
  });

  // jitter="full" は exp * random
  it("applies full jitter with injected random", () => {
    // random=0.5 → exp*0.5 = 100*4*0.5 = 200
    const policy = basePolicy({
      backoffBaseMs: 100,
      backoffMaxMs: 10_000,
      jitter: "full",
      random: () => 0.5,
    });
    expect(computeBackoff(2, policy)).toBe(200);
  });

  // random が 0 を返したら最小 1ms に丸める
  it("returns at least 1ms even when random returns 0", () => {
    // random=0 → exp*0=0 → max(1, 0)=1
    const policy = basePolicy({
      backoffBaseMs: 100,
      backoffMaxMs: 10_000,
      jitter: "full",
      random: () => 0,
    });
    expect(computeBackoff(2, policy)).toBe(1);
  });

  // random 注入が無い場合 (Math.random を使う) のカバレッジを取る
  it("uses Math.random when random is not injected", () => {
    // random なし
    const policy = basePolicy({
      backoffBaseMs: 100,
      backoffMaxMs: 1000,
      jitter: "full",
    });
    // 結果は 1..1000 の範囲
    const result = computeBackoff(2, policy);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(1000);
  });

  // jitter="none" でも 0 にならない (max(1) 適用)
  it('returns 1ms when exp is 0 in "none" jitter', () => {
    // base=0 → 0*2^0=0 → max(1, 0)=1
    const policy = basePolicy({ backoffBaseMs: 0, backoffMaxMs: 10, jitter: "none" });
    expect(computeBackoff(0, policy)).toBe(1);
  });
});

// shouldRetryEntry の動作
describe("shouldRetryEntry", () => {
  // user shouldRetry が指定されていればそれを使う
  it("uses policy.shouldRetry when provided", () => {
    // shouldRetry=false で常に false
    const policy = basePolicy({ shouldRetry: () => false });
    expect(shouldRetryEntry(makeEntry(), new Error("x"), policy)).toBe(false);
  });

  // OutboxError({ retryable: false }) は即 false
  it("returns false when OutboxError.retryable is false", () => {
    // 既定 policy
    const policy = basePolicy();
    // retryable=false のエラー
    const err = new OutboxError({ code: "OUTBOX_PUBLISH_FAILED", message: "x", retryable: false });
    expect(shouldRetryEntry(makeEntry(), err, policy)).toBe(false);
  });

  // attemptCount が maxAttempts に達したら false
  it("returns false when attempt count exhausted", () => {
    // 既定 policy
    const policy = basePolicy();
    // attemptCount=3 / maxAttempts=3 → 上限到達
    const entry = makeEntry({ attemptCount: 3, maxAttempts: 3 });
    expect(shouldRetryEntry(entry, new Error("x"), policy)).toBe(false);
  });

  // 上記いずれにも当てはまらなければ true
  it("returns true by default", () => {
    // 既定 policy
    const policy = basePolicy();
    expect(shouldRetryEntry(makeEntry(), new Error("x"), policy)).toBe(true);
  });

  // OutboxError(retryable=true) は通常通り再試行
  it("returns true for OutboxError with retryable=true", () => {
    // 既定 policy
    const policy = basePolicy();
    // retryable=true のエラー (既定)
    const err = new OutboxError({ code: "OUTBOX_PUBLISH_FAILED", message: "x" });
    expect(shouldRetryEntry(makeEntry(), err, policy)).toBe(true);
  });
});
