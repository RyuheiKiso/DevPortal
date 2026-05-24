// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import {
  httpClientConfigSchema,
  retryPolicySchema,
  timeoutPolicySchema,
  validateHttpClientConfig,
} from "./schema.js";

describe("retryPolicySchema", () => {
  // 正常パス
  it("正常な値を受け入れる", () => {
    expect(() =>
      retryPolicySchema.parse({
        maxRetries: 3,
        backoffBaseMs: 200,
        backoffMaxMs: 10000,
        jitter: "full",
        retryableStatuses: [500, 503],
      }),
    ).not.toThrow();
  });
  // maxRetries 負数は拒否
  it("maxRetries 負数は拒否", () => {
    expect(() =>
      retryPolicySchema.parse({ maxRetries: -1, backoffBaseMs: 0 }),
    ).toThrow();
  });
  // jitter 不正値は拒否
  it("jitter 不正値は拒否", () => {
    expect(() =>
      retryPolicySchema.parse({
        maxRetries: 1,
        backoffBaseMs: 1,
        jitter: "x",
      }),
    ).toThrow();
  });
});

describe("timeoutPolicySchema", () => {
  // 全任意フィールド
  it("空オブジェクトを受け入れる", () => {
    expect(() => timeoutPolicySchema.parse({})).not.toThrow();
  });
  // 整数値
  it("整数値を受け入れる", () => {
    expect(() =>
      timeoutPolicySchema.parse({ totalMs: 1000, perAttemptMs: 500 }),
    ).not.toThrow();
  });
});

describe("httpClientConfigSchema / validateHttpClientConfig", () => {
  // 完全な設定
  it("有効な設定を parse できる", () => {
    const out = validateHttpClientConfig({
      baseUrl: "https://api.example.com",
      defaultHeaders: { "X-Tenant": "acme" },
      retry: { maxRetries: 3, backoffBaseMs: 200, jitter: "full" },
      timeout: { totalMs: 30000 },
    });
    expect(out.baseUrl).toBe("https://api.example.com");
  });
  // 無効な baseUrl
  it("baseUrl が URL でなければ throw", () => {
    expect(() => validateHttpClientConfig({ baseUrl: "not-a-url" })).toThrow();
  });
  // schema export 検証
  it("httpClientConfigSchema は zod スキーマ", () => {
    expect(typeof httpClientConfigSchema.parse).toBe("function");
  });
});
