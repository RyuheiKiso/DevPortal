// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// 公開 API 経由で schema 関連を取り込み
import {
  appErrorInputSchema,
  appErrorKindSchema,
  appErrorSeveritySchema,
  errorContextSchema,
  safeValidateAppErrorInput,
  validateAppErrorInput,
  validationIssueSchema,
} from "./index.js";

// 列挙 schema の正常 / 異常を網羅
describe("enum schemas", () => {
  // kind 全値を受け付ける
  it("accepts all AppErrorKind values", () => {
    for (const kind of [
      "network",
      "timeout",
      "http",
      "auth",
      "permission",
      "validation",
      "business",
      "conflict",
      "notFound",
      "system",
      "unknown",
    ] as const) {
      expect(appErrorKindSchema.parse(kind)).toBe(kind);
    }
  });

  // 未定義 kind は拒否
  it("rejects unknown kind values", () => {
    expect(() => appErrorKindSchema.parse("bogus")).toThrow();
  });

  // severity 全値を受け付ける
  it("accepts all AppErrorSeverity values", () => {
    for (const severity of ["info", "warning", "error", "critical"] as const) {
      expect(appErrorSeveritySchema.parse(severity)).toBe(severity);
    }
  });

  // 未定義 severity は拒否
  it("rejects unknown severity values", () => {
    expect(() => appErrorSeveritySchema.parse("hot")).toThrow();
  });
});

// validationIssue schema
describe("validationIssueSchema", () => {
  // 最小構成 (message のみ) で成立
  it("accepts a minimal issue", () => {
    expect(validationIssueSchema.parse({ message: "x" })).toEqual({ message: "x" });
  });

  // message が無いと失敗
  it("rejects when message is missing", () => {
    expect(() => validationIssueSchema.parse({ code: "x" })).toThrow();
  });
});

// errorContext schema
describe("errorContextSchema", () => {
  // 全フィールドオプショナルなので空 object も通る
  it("accepts an empty object", () => {
    expect(errorContextSchema.parse({})).toEqual({});
  });

  // tags は文字列配列が必要
  it("rejects non-string tag entries", () => {
    expect(() => errorContextSchema.parse({ tags: [1] })).toThrow();
  });
});

// validateAppErrorInput の throw 動作
describe("validateAppErrorInput", () => {
  // 妥当な入力は parse 結果を返す
  it("returns parsed value when valid", () => {
    const parsed = validateAppErrorInput({ kind: "business", message: "rejected" });
    expect(parsed.kind).toBe("business");
  });

  // 不正な kind は throw
  it("throws when kind is invalid", () => {
    expect(() => validateAppErrorInput({ kind: "bad" })).toThrow();
  });
});

// safeValidateAppErrorInput の success / failure 分岐
describe("safeValidateAppErrorInput", () => {
  // 妥当な入力は success=true
  it("returns success when valid", () => {
    const result = safeValidateAppErrorInput({ kind: "business" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("business");
    }
  });

  // 不正な入力は success=false で ZodError を返す
  it("returns failure with ZodError when invalid", () => {
    const result = safeValidateAppErrorInput({ kind: "bad" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

// appErrorInputSchema 全体
describe("appErrorInputSchema", () => {
  // optional フィールドすべて省略可能
  it("accepts a minimal input with only kind", () => {
    expect(appErrorInputSchema.parse({ kind: "unknown" })).toEqual({ kind: "unknown" });
  });

  // 全フィールド指定でも受け付ける
  it("accepts a fully-populated input", () => {
    const result = appErrorInputSchema.parse({
      kind: "validation",
      message: "m",
      userMessage: "u",
      code: "C",
      status: 400,
      requestId: "r",
      traceId: "t",
      details: {},
      cause: new Error("x"),
      retryable: false,
      reportable: false,
      severity: "warning",
      validationIssues: [{ message: "v" }],
      context: { operation: "op" },
    });
    expect(result.kind).toBe("validation");
  });
});
