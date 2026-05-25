// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// kind 値配列と既定値ヘルパを取り込み
import { appErrorKindValues, defaultReportable, defaultRetryable, defaultSeverity, defaultUserMessage } from "./index.js";

// defaultUserMessage は全 kind に対して非空文字列を返す
describe("defaultUserMessage", () => {
  // 全 kind を網羅して文字列を返すことを確認
  it("returns a non-empty string for every kind", () => {
    for (const kind of appErrorKindValues) {
      const message = defaultUserMessage(kind);
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

// defaultSeverity の分岐網羅
describe("defaultSeverity", () => {
  // system / unknown は critical
  it("returns critical for system and unknown", () => {
    expect(defaultSeverity("system")).toBe("critical");
    expect(defaultSeverity("unknown")).toBe("critical");
  });

  // ユーザー修正可能な分類は warning
  it("returns warning for user-fixable kinds", () => {
    expect(defaultSeverity("validation")).toBe("warning");
    expect(defaultSeverity("business")).toBe("warning");
    expect(defaultSeverity("conflict")).toBe("warning");
    expect(defaultSeverity("notFound")).toBe("warning");
  });

  // それ以外は error
  it("returns error for the rest", () => {
    expect(defaultSeverity("network")).toBe("error");
    expect(defaultSeverity("timeout")).toBe("error");
    expect(defaultSeverity("http")).toBe("error");
    expect(defaultSeverity("auth")).toBe("error");
    expect(defaultSeverity("permission")).toBe("error");
  });
});

// defaultRetryable の分岐網羅
describe("defaultRetryable", () => {
  // network / timeout / conflict は kind 単独で retryable
  it("returns true for network / timeout / conflict regardless of status", () => {
    expect(defaultRetryable("network")).toBe(true);
    expect(defaultRetryable("timeout")).toBe(true);
    // conflict は楽観ロック / バージョン衝突の再試行を許可する設計
    expect(defaultRetryable("conflict")).toBe(true);
    expect(defaultRetryable("network", 200)).toBe(true);
    // conflict + 非リトライ status でも kind 単独経路で true
    expect(defaultRetryable("conflict", 200)).toBe(true);
  });

  // status を渡したときは HTTP セマンティクスで判定
  it("uses HTTP semantics when status is provided", () => {
    expect(defaultRetryable("http", 408)).toBe(true);
    expect(defaultRetryable("http", 409)).toBe(true);
    expect(defaultRetryable("http", 429)).toBe(true);
    expect(defaultRetryable("http", 500)).toBe(true);
    expect(defaultRetryable("http", 503)).toBe(true);
    expect(defaultRetryable("http", 200)).toBe(false);
    expect(defaultRetryable("http", 400)).toBe(false);
  });

  // status 未指定で network / timeout / conflict 以外は false
  it("returns false for non-retry kinds without status", () => {
    expect(defaultRetryable("business")).toBe(false);
    expect(defaultRetryable("validation")).toBe(false);
    expect(defaultRetryable("auth")).toBe(false);
    expect(defaultRetryable("permission")).toBe(false);
    expect(defaultRetryable("notFound")).toBe(false);
    expect(defaultRetryable("system")).toBe(false);
    expect(defaultRetryable("unknown")).toBe(false);
    expect(defaultRetryable("http")).toBe(false);
  });
});

// defaultReportable の分岐網羅
describe("defaultReportable", () => {
  // 通報対象 kind は true
  it("returns true for reportable kinds", () => {
    expect(defaultReportable("system")).toBe(true);
    expect(defaultReportable("unknown")).toBe(true);
    expect(defaultReportable("http")).toBe(true);
    expect(defaultReportable("network")).toBe(true);
    expect(defaultReportable("timeout")).toBe(true);
  });

  // ユーザー側起因は通報対象外
  it("returns false for user-fault kinds", () => {
    expect(defaultReportable("auth")).toBe(false);
    expect(defaultReportable("permission")).toBe(false);
    expect(defaultReportable("validation")).toBe(false);
    expect(defaultReportable("business")).toBe(false);
    expect(defaultReportable("conflict")).toBe(false);
    expect(defaultReportable("notFound")).toBe(false);
  });
});
