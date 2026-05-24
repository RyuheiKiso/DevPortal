// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import {
  grpcClientConfigSchema,
  httpClientConfigSchema,
  retryPolicySchema,
  timeoutPolicySchema,
  validateGrpcClientConfig,
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
  // C-A7: requestIdHeader 空文字は schema レベルでも拒否
  it("C-A7: requestIdHeader 空文字は schema が拒否", () => {
    expect(() => validateHttpClientConfig({ requestIdHeader: "" })).toThrow();
  });
  // C-A7: requestIdHeader 非空は通る
  it("C-A7: requestIdHeader が非空文字なら通る", () => {
    expect(() => validateHttpClientConfig({ requestIdHeader: "traceparent" })).not.toThrow();
  });
  // schema export 検証
  it("httpClientConfigSchema は zod スキーマ", () => {
    expect(typeof httpClientConfigSchema.parse).toBe("function");
  });
});

describe("grpcClientConfigSchema / validateGrpcClientConfig", () => {
  // 正常パス
  it("有効な GrpcClientConfig を parse できる", () => {
    expect(() =>
      validateGrpcClientConfig({
        baseUrl: "https://grpc.example.com",
        timeoutMs: 5000,
        retry: { maxRetries: 2, backoffBaseMs: 100 },
      }),
    ).not.toThrow();
  });
  // baseUrl 不在は拒否
  it("baseUrl 未指定は拒否", () => {
    expect(() => validateGrpcClientConfig({})).toThrow();
  });
  // baseUrl 空文字は拒否
  it("baseUrl 空文字は拒否", () => {
    expect(() => validateGrpcClientConfig({ baseUrl: "" })).toThrow();
  });
  // baseUrl が URL でないなら拒否
  it("baseUrl が URL でないなら拒否", () => {
    expect(() => validateGrpcClientConfig({ baseUrl: "not-url" })).toThrow();
  });
  // schema export
  it("grpcClientConfigSchema は zod スキーマ", () => {
    expect(typeof grpcClientConfigSchema.parse).toBe("function");
  });
  // B-2: retry 内部スキーマの透過（不正値が retry 経由で拒否される）
  it("B-2: retry.maxRetries の不正値は透過的に拒否", () => {
    expect(() =>
      validateGrpcClientConfig({
        baseUrl: "https://grpc.example.com",
        retry: { maxRetries: -1 },
      }),
    ).toThrow();
  });
  // B-2: timeoutMs 負数は拒否
  it("B-2: timeoutMs 負数は拒否", () => {
    expect(() =>
      validateGrpcClientConfig({
        baseUrl: "https://grpc.example.com",
        timeoutMs: -1,
      }),
    ).toThrow();
  });
});
