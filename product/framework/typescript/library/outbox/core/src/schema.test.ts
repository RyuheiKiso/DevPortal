// vitest API
import { describe, expect, it } from "vitest";
// zod 由来のエラー
import { ZodError } from "zod";
// 対象
import {
  dlqAutoArchiveSchema,
  outboxManagerConfigSchema,
  retryPolicySchema,
  schedulerOptionsSchema,
  validateOutboxManagerConfig,
} from "./schema.js";

// retryPolicySchema の検証
describe("retryPolicySchema", () => {
  // 正常値が通る
  it("accepts valid retry policy", () => {
    // 正常な partial 値
    const value = retryPolicySchema.parse({ maxRetries: 3, backoffBaseMs: 100, backoffMaxMs: 5000, jitter: "full" });
    // 値が保持される
    expect(value.maxRetries).toBe(3);
  });

  // 不正値で失敗
  it("rejects negative maxRetries", () => {
    // -1 は不正
    expect(() => retryPolicySchema.parse({ maxRetries: -1 })).toThrow(ZodError);
  });

  // jitter の値が不正
  it("rejects invalid jitter strategy", () => {
    // "x" は対象外
    expect(() => retryPolicySchema.parse({ jitter: "x" })).toThrow(ZodError);
  });

  // 0 は backoffMaxMs として不正
  it("rejects zero backoffMaxMs", () => {
    // 0 は positive 違反
    expect(() => retryPolicySchema.parse({ backoffMaxMs: 0 })).toThrow(ZodError);
  });
});

// schedulerOptionsSchema の検証
describe("schedulerOptionsSchema", () => {
  // 正常値
  it("accepts valid scheduler options", () => {
    // 正常 partial
    const value = schedulerOptionsSchema.parse({ intervalMs: 1000, jitterRatio: 0.2, batchSize: 5, autoStart: true });
    // 値が保持
    expect(value.intervalMs).toBe(1000);
  });

  // intervalMs=0 は不正
  it("rejects zero intervalMs", () => {
    // 0 は positive 違反
    expect(() => schedulerOptionsSchema.parse({ intervalMs: 0 })).toThrow(ZodError);
  });

  // jitterRatio が 1 超過は不正
  it("rejects jitterRatio > 1", () => {
    // 1.5 は範囲外
    expect(() => schedulerOptionsSchema.parse({ jitterRatio: 1.5 })).toThrow(ZodError);
  });

  // batchSize が負は不正
  it("rejects non-positive batchSize", () => {
    // -1 は positive 違反
    expect(() => schedulerOptionsSchema.parse({ batchSize: -1 })).toThrow(ZodError);
  });
});

// dlqAutoArchiveSchema の検証
describe("dlqAutoArchiveSchema", () => {
  // 正常値
  it("accepts valid dlqAutoArchive", () => {
    // 正常値
    const value = dlqAutoArchiveSchema.parse({ maxEntries: 100 });
    expect(value.maxEntries).toBe(100);
  });

  // maxEntries が 0 以下は不正
  it("rejects zero maxEntries", () => {
    // positive 違反
    expect(() => dlqAutoArchiveSchema.parse({ maxEntries: 0 })).toThrow(ZodError);
  });
});

// outboxManagerConfigSchema / validateOutboxManagerConfig
describe("outboxManagerConfigSchema", () => {
  // 全 partial を組み合わせた正常値
  it("accepts a full valid config object", () => {
    // すべての partial を満たす
    const value = outboxManagerConfigSchema.parse({
      retry: { maxRetries: 3 },
      scheduler: { intervalMs: 1000 },
      dlqAutoArchive: { maxEntries: 50 },
      perAttemptTimeoutMs: 5000,
    });
    // 構造が保持される
    expect(value.retry?.maxRetries).toBe(3);
  });

  // perAttemptTimeoutMs が 0 以下は不正
  it("rejects non-positive perAttemptTimeoutMs", () => {
    // 0 は positive 違反
    expect(() => outboxManagerConfigSchema.parse({ perAttemptTimeoutMs: 0 })).toThrow(ZodError);
  });

  // validateOutboxManagerConfig が同じ動作
  it("validateOutboxManagerConfig throws on invalid input", () => {
    // 不正値で throw
    expect(() => validateOutboxManagerConfig({ retry: { maxRetries: -1 } })).toThrow(ZodError);
  });
});
