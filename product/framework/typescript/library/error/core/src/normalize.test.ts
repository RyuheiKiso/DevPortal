// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// 公開 API 経由で normalize と関連関数を取り込み
import { createAppError, isAppError, normalizeError } from "./index.js";

// normalizeError オーケストレーションの分岐網羅
describe("normalizeError", () => {
  // 既存 AppError はそのまま返す（context / request id / trace id を必要時のみ補完）
  it("preserves AppError as-is and fills missing context", () => {
    const original = createAppError({ kind: "business", message: "Rule rejected" });
    const normalized = normalizeError(original, { operation: "approve", requestId: "req-1" });

    expect(isAppError(normalized)).toBe(true);
    expect(normalized.context?.operation).toBe("approve");
    expect(normalized.requestId).toBe("req-1");
  });

  // 既存 AppError の context は上書きされない（既存値が勝つ shallow merge）
  it("does not overwrite existing AppError context", () => {
    const original = createAppError({ kind: "business", context: { operation: "original" } });
    const normalized = normalizeError(original, { operation: "next", traceId: "trace-2" });

    // 既存キー (operation) は勝つ
    expect(normalized.context?.operation).toBe("original");
    // トップレベル traceId は欠落補完される
    expect(normalized.traceId).toBe("trace-2");
  });

  // shallowMerge (既定): 既存 context に無いキーは options 由来で補完される
  it("shallow-merges options-derived context into existing AppError context", () => {
    const original = createAppError({ kind: "business", context: { operation: "existing" } });
    const normalized = normalizeError(original, {
      operation: "ignored",
      tags: ["urgent"],
      requestId: "req-from-options",
    });

    // 既存 operation は勝つ
    expect(normalized.context?.operation).toBe("existing");
    // tags は既存に無いので補完される
    expect(normalized.context?.tags).toEqual(["urgent"]);
    // requestId は context にも欠落 → 補完
    expect(normalized.context?.requestId).toBe("req-from-options");
    // requestId のトップレベル補完
    expect(normalized.requestId).toBe("req-from-options");
  });

  // contextStrategy="preserveExisting" は旧挙動を再現する（既存 context があれば options 由来は採用しない）
  it("preserves existing context only when contextStrategy is 'preserveExisting'", () => {
    const original = createAppError({ kind: "business", context: { operation: "existing" } });
    const normalized = normalizeError(original, {
      operation: "ignored",
      tags: ["urgent"],
      contextStrategy: "preserveExisting",
    });

    // 既存 context が完全採用される（options 由来は反映されない）
    expect(normalized.context?.operation).toBe("existing");
    expect(normalized.context?.tags).toBeUndefined();
  });

  // 既存 AppError に context が無く preserveExisting → options 由来を採用
  it("falls back to options-derived context when preserveExisting and existing is undefined", () => {
    const original = createAppError({ kind: "business" });
    const normalized = normalizeError(original, {
      operation: "next",
      contextStrategy: "preserveExisting",
    });
    expect(normalized.context?.operation).toBe("next");
  });

  // 既存 AppError に context があり options 由来 context が無いとき shallow merge は既存をそのまま採用
  it("returns existing context unchanged when no options context (shallowMerge)", () => {
    const original = createAppError({ kind: "business", context: { operation: "existing" } });
    const normalized = normalizeError(original, { contextStrategy: "shallowMerge" });
    expect(normalized.context?.operation).toBe("existing");
  });

  // 既存 AppError にも options にも context が無いとき shallow merge は undefined
  it("returns undefined context when both existing and options are missing (shallowMerge)", () => {
    const original = createAppError({ kind: "business" });
    const normalized = normalizeError(original, { contextStrategy: "shallowMerge" });
    expect(normalized.context).toBeUndefined();
  });

  // Zod 風 issues を持つ object は validation 経路
  it("normalizes Zod-like validation containers", () => {
    const error = normalizeError({
      issues: [{ path: ["customer", "name"], code: "too_small", message: "Name is required" }],
    });

    expect(error.kind).toBe("validation");
    expect(error.userMessage).toBe("Name is required");
    expect(error.validationIssues).toHaveLength(1);
    expect(error.reportable).toBe(false);
  });

  // HTTP 風 object は HTTP 経路
  it("normalizes HTTP-like objects", () => {
    const error = normalizeError({
      message: "Request failed",
      status: 422,
      code: "INVALID",
      requestId: "req-1",
    });

    expect(error.kind).toBe("validation");
    expect(error.status).toBe(422);
    expect(error.requestId).toBe("req-1");
  });

  // HTTP-like + body.issues は HTTP 経路で処理しつつ validationIssues も併設される
  // status / requestId / traceId が失われずに validation 情報を保持できる
  it("normalizes HTTP-like with body.issues and keeps HTTP metadata", () => {
    const error = normalizeError({
      status: 422,
      requestId: "req-1",
      response: { body: { issues: [{ message: "Name is required" }] } },
    });

    // status 由来で kind=validation
    expect(error.kind).toBe("validation");
    expect(error.status).toBe(422);
    expect(error.requestId).toBe("req-1");
    // body 内の issues が validationIssues に併設される
    expect(error.validationIssues).toHaveLength(1);
    expect(error.validationIssues?.[0]?.message).toBe("Name is required");
  });

  // Error instance + code: code から kind 推定
  it("normalizes Error instances using code for classification", () => {
    const error = new Error("Timed out") as Error & { code?: string };
    error.code = "ETIMEDOUT";

    const normalized = normalizeError(error, { component: "SaveButton" });

    expect(normalized.kind).toBe("timeout");
    expect(normalized.context?.component).toBe("SaveButton");
    expect(normalized.cause).toBe(error);
  });

  // Error instance / includeCause=false → cause を破棄
  it("drops cause when includeCause is false", () => {
    const inner = new Error("inner cause");
    const error = new Error("outer", { cause: inner });

    const normalized = normalizeError(error, { includeCause: false });

    expect(normalized.cause).toBeUndefined();
  });

  // Error instance / cause を明示保持
  it("keeps Error cause when present", () => {
    const inner = new Error("inner");
    const error = new Error("outer", { cause: inner });

    const normalized = normalizeError(error);

    expect(normalized.cause).toBe(inner);
  });

  // Error instance / defaultUserMessage と defaultKind を採用
  it("honors defaultKind and defaultUserMessage for unclassified Error instances", () => {
    const error = new Error("opaque");

    const normalized = normalizeError(error, {
      defaultKind: "business",
      defaultUserMessage: "Please retry later.",
    });

    expect(normalized.kind).toBe("business");
    expect(normalized.userMessage).toBe("Please retry later.");
  });

  // Error instance / code が string 以外なら code は採用しない
  it("ignores non-string code on Error instances", () => {
    const error = new Error("with bad code") as Error & { code?: unknown };
    error.code = 123;

    const normalized = normalizeError(error);

    expect(normalized.code).toBeUndefined();
  });

  // plain object (HTTP でも validation でもない) → unknown 系として扱う
  it("normalizes thrown plain objects without HTTP markers", () => {
    const normalized = normalizeError({ requestId: "req-only", code: "CUSTOM_CODE" });

    expect(normalized.kind).toBe("unknown");
    expect(normalized.message).toBe("Non-error object was thrown");
    expect(normalized.details).toEqual({ requestId: "req-only", code: "CUSTOM_CODE" });
  });

  // plain object に message があれば採用
  it("uses message from thrown record when present", () => {
    const normalized = normalizeError({ message: "explicit", foo: 1 });
    expect(normalized.message).toBe("explicit");
  });

  // plain object / includeCause=false → cause を破棄
  it("drops cause for plain objects when includeCause is false", () => {
    const normalized = normalizeError({ message: "x" }, { includeCause: false });
    expect(normalized.cause).toBeUndefined();
  });

  // plain object / classifyErrorCode で kind を上書き
  it("uses code-based classification for plain objects", () => {
    const normalized = normalizeError({ code: "NETWORK_DOWN", message: "x" });
    expect(normalized.kind).toBe("network");
  });

  // string thrown は message として採用
  it("normalizes string thrown values", () => {
    expect(normalizeError("plain failure").message).toBe("plain failure");
  });

  // null / undefined / number thrown は generic message
  it("normalizes primitive thrown values to generic message", () => {
    expect(normalizeError(null, { defaultKind: "system" }).kind).toBe("system");
    expect(normalizeError(null).message).toBe("Unknown thrown value");
    expect(normalizeError(42).message).toBe("Unknown thrown value");
  });

  // primitive / includeCause=false → cause 破棄
  it("drops cause for primitives when includeCause is false", () => {
    expect(normalizeError("plain", { includeCause: false }).cause).toBeUndefined();
  });

  // options 完全省略 → context は undefined
  it("returns no context when no context fields were provided", () => {
    expect(normalizeError("plain").context).toBeUndefined();
  });

  // options に tags / metadata のみ → context が組み立てられる
  it("builds context from any single ErrorContext field", () => {
    const normalized = normalizeError("plain", { tags: ["urgent"], metadata: { key: "v" } });
    expect(normalized.context).toEqual({
      operation: undefined,
      component: undefined,
      requestId: undefined,
      traceId: undefined,
      tags: ["urgent"],
      metadata: { key: "v" },
    });
  });

  // options を何も渡さなくても動く (default 引数経路)
  it("works without any options argument", () => {
    const normalized = normalizeError("plain");
    expect(normalized.kind).toBe("unknown");
  });

  // includeCause=true 明示でも cause は保持
  it("keeps cause when includeCause is true", () => {
    const normalized = normalizeError("plain", { includeCause: true });
    expect(normalized.cause).toBe("plain");
  });
});
