// vitest のテスト API を読み込む
import { describe, expect, it } from "vitest";
// 公開 API をまとめて検証する
import {
  appErrorInputSchema,
  classifyErrorCode,
  classifyHttpStatus,
  createAppError,
  defaultReportable,
  defaultRetryable,
  defaultSeverity,
  defaultUserMessage,
  extractValidationIssues,
  fromHttpError,
  fromValidationError,
  isAppError,
  isHttpErrorLike,
  isRecord,
  normalizeError,
  serializeError,
  toLogRecord,
  toNotification,
  validateAppErrorInput,
} from "./index.js";

// core の公開 API と主要分岐を検証する
describe("error core", () => {
  // HTTP status から AppErrorKind への変換を検証する
  it("classifies common HTTP status codes", () => {
    // network / timeout 系を検証する
    expect(classifyHttpStatus(0)).toBe("network");
    expect(classifyHttpStatus(408)).toBe("timeout");
    expect(classifyHttpStatus(504)).toBe("timeout");
    // 業務アプリでよく扱う status を検証する
    expect(classifyHttpStatus(400)).toBe("validation");
    expect(classifyHttpStatus(422)).toBe("validation");
    expect(classifyHttpStatus(401)).toBe("auth");
    expect(classifyHttpStatus(403)).toBe("permission");
    expect(classifyHttpStatus(404)).toBe("notFound");
    expect(classifyHttpStatus(409)).toBe("conflict");
    expect(classifyHttpStatus(412)).toBe("conflict");
    expect(classifyHttpStatus(500)).toBe("system");
    expect(classifyHttpStatus(418)).toBe("http");
  });

  // error code から AppErrorKind への変換を検証する
  it("classifies common error code patterns", () => {
    // 未指定 code は分類しない
    expect(classifyErrorCode(undefined)).toBeUndefined();
    // 通信系 code を検証する
    expect(classifyErrorCode("ETIMEDOUT")).toBe("timeout");
    expect(classifyErrorCode("NETWORK_ERROR")).toBe("network");
    expect(classifyErrorCode("ECONNREFUSED")).toBe("network");
    expect(classifyErrorCode("ENOTFOUND")).toBe("network");
    // 入力・認証・認可・競合・未検出を検証する
    expect(classifyErrorCode("VALIDATION_FAILED")).toBe("validation");
    expect(classifyErrorCode("INVALID_INPUT")).toBe("validation");
    expect(classifyErrorCode("UNAUTHORIZED")).toBe("auth");
    expect(classifyErrorCode("PERMISSION_DENIED")).toBe("permission");
    expect(classifyErrorCode("FORBIDDEN")).toBe("permission");
    expect(classifyErrorCode("VERSION_CONFLICT")).toBe("conflict");
    expect(classifyErrorCode("CUSTOMER_NOT_FOUND")).toBe("notFound");
    // 未知 code は分類しない
    expect(classifyErrorCode("SOME_BUSINESS_RULE")).toBeUndefined();
  });

  // AppError の default 値を検証する
  it("creates AppError with safe defaults", () => {
    // validation はユーザー修正可能な warning として扱う
    const validation = createAppError({ kind: "validation" });
    expect(validation.userMessage).toBe(defaultUserMessage("validation"));
    expect(validation.severity).toBe(defaultSeverity("validation"));
    expect(validation.retryable).toBe(defaultRetryable("validation"));
    expect(validation.reportable).toBe(defaultReportable("validation"));
    // 5xx は retryable として扱う
    const system = createAppError({ kind: "system", status: 503 });
    expect(system.retryable).toBe(true);
    expect(system.reportable).toBe(true);
  });

  // HTTP 風 object の正規化を検証する
  it("normalizes HttpError-like objects", () => {
    // 422 は validation に分類される
    const error = normalizeError({
      message: "Request failed",
      status: 422,
      code: "INVALID_CUSTOMER",
      requestId: "req-1",
      details: { field: "name" },
    });

    expect(error.kind).toBe("validation");
    expect(error.status).toBe(422);
    expect(error.requestId).toBe("req-1");
    expect(error.reportable).toBe(false);
  });

  // response headers から requestId / traceId を拾う経路を検証する
  it("normalizes response headers and response data", () => {
    // Headers 互換の plain object を使って requestId と traceId を渡す
    const error = fromHttpError({
      statusCode: 429,
      response: {
        headers: {
          "x-request-id": "req-from-header",
          traceparent: "trace-from-header",
        },
        data: { reason: "rate limit" },
      },
    });

    expect(error.kind).toBe("http");
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.requestId).toBe("req-from-header");
    expect(error.traceId).toBe("trace-from-header");
    expect(error.details).toEqual({ reason: "rate limit" });
  });

  // Headers class を使う環境でも header を読めることを検証する
  it("reads Web Headers when available", () => {
    // DOM Headers を使って大小文字違いの lookup を検証する
    const headers = new Headers({ "X-Request-Id": "req-web", traceparent: "trace-web" });
    const error = fromHttpError({
      response: {
        status: 504,
        headers,
        body: { message: "gateway timeout" },
      },
    });

    expect(error.kind).toBe("timeout");
    expect(error.requestId).toBe("req-web");
    expect(error.traceId).toBe("trace-web");
    expect(error.details).toEqual({ message: "gateway timeout" });
  });

  // HTTP error 判定が広すぎないことを検証する
  it("detects only explicit HTTP-like errors", () => {
    // status があれば HTTP 系として扱う
    expect(isHttpErrorLike({ status: 500 })).toBe(true);
    // response があれば HTTP 系として扱う
    expect(isHttpErrorLike({ response: { status: 404 } })).toBe(true);
    // requestId だけでは HTTP 系として扱わない
    expect(isHttpErrorLike({ requestId: "req-only" })).toBe(false);
    // object 以外は HTTP 系として扱わない
    expect(isHttpErrorLike("boom")).toBe(false);
  });

  // validation issue の抽出と正規化を検証する
  it("normalizes validation issue containers", () => {
    // Zod 風 issues を AppError に変換する
    const error = normalizeError({
      issues: [{ path: ["customer", "name"], code: "too_small", message: "Name is required" }],
    });

    expect(error.kind).toBe("validation");
    expect(error.userMessage).toBe("Name is required");
    expect(error.validationIssues).toHaveLength(1);
  });

  // validation issue の不正要素を捨てることを検証する
  it("filters invalid validation issue entries", () => {
    // message を持たない issue は公開しない
    const issues = extractValidationIssues({
      issues: [{ path: ["x"], code: "bad" }, null, { message: "Valid issue", path: [0] }],
    });

    expect(issues).toEqual([{ path: [0], code: undefined, message: "Valid issue" }]);
    expect(fromValidationError(new Error("invalid")).validationIssues).toBeUndefined();
  });

  // 既存 AppError の正規化を検証する
  it("keeps AppError values stable and adds missing context", () => {
    // context が未設定なら options 由来の context を補う
    const original = createAppError({ kind: "business", message: "Rule rejected" });
    const normalized = normalizeError(original, { operation: "approve" });

    expect(isAppError(normalized)).toBe(true);
    expect(normalized.context?.operation).toBe("approve");
  });

  // 既存 AppError の context を壊さないことを検証する
  it("does not overwrite existing AppError context", () => {
    // 既存 context が優先される
    const original = createAppError({ kind: "business", context: { operation: "original" } });
    const normalized = normalizeError(original, { operation: "next", requestId: "req-2" });

    expect(normalized.context?.operation).toBe("original");
    expect(normalized.requestId).toBe("req-2");
  });

  // Error instance の正規化を検証する
  it("normalizes Error instances and honors options", () => {
    // cause と code を持つ Error を作る
    const error = new Error("Timed out", { cause: new Error("socket") }) as Error & { code?: string };
    error.code = "ETIMEDOUT";

    // defaultUserMessage と includeCause=false を検証する
    const normalized = normalizeError(error, {
      defaultUserMessage: "Please retry later.",
      includeCause: false,
      component: "SaveButton",
    });

    expect(normalized.kind).toBe("timeout");
    expect(normalized.userMessage).toBe("Please retry later.");
    expect(normalized.cause).toBeUndefined();
    expect(normalized.context?.component).toBe("SaveButton");
  });

  // 非 Error object の正規化を検証する
  it("normalizes thrown objects without treating requestId-only objects as HTTP", () => {
    // requestId だけの object は unknown object として扱う
    const normalized = normalizeError({ requestId: "req-only", code: "CUSTOM_CODE" });

    expect(normalized.kind).toBe("unknown");
    expect(normalized.message).toBe("Non-error object was thrown");
    expect(normalized.details).toEqual({ requestId: "req-only", code: "CUSTOM_CODE" });
  });

  // primitive thrown value の正規化を検証する
  it("normalizes primitive thrown values", () => {
    // string は message として扱う
    expect(normalizeError("plain failure").message).toBe("plain failure");
    // null は unknown thrown value として扱う
    expect(normalizeError(null, { defaultKind: "system" }).kind).toBe("system");
    // 空 options では context を付けない
    expect(normalizeError("plain failure").context).toBeUndefined();
  });

  // adapter と serialize を検証する
  it("creates log and notification adapter payloads", () => {
    // system error を log / notification / serialized payload に変換する
    const error = normalizeError(new Error("boom"), { defaultKind: "system", operation: "save" });
    const log = toLogRecord(error);
    const notification = toNotification(error);
    const serialized = serializeError(error);

    expect(log.kind).toBe("system");
    expect(log.context?.operation).toBe("save");
    expect(notification.level).toBe("error");
    expect(serialized.name).toBe("AppError");
  });

  // notification level の分岐を検証する
  it("maps severity to notification levels", () => {
    // info severity は info toast にする
    expect(toNotification(createAppError({ kind: "business", severity: "info" })).level).toBe("info");
    // warning severity は warning toast にする
    expect(toNotification(createAppError({ kind: "validation" })).level).toBe("warning");
    // validation は入力エラータイトルにする
    expect(toNotification(createAppError({ kind: "validation" })).title).toBe("Input error");
  });

  // 型 guard と schema を検証する
  it("validates guards and schemas", () => {
    // object 判定を検証する
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    // AppError 判定を検証する
    expect(isAppError(createAppError({ kind: "unknown" }))).toBe(true);
    expect(isAppError({ name: "AppError" })).toBe(false);
    // schema parse を検証する
    expect(validateAppErrorInput({ kind: "business", message: "Rejected" }).kind).toBe("business");
    expect(() => appErrorInputSchema.parse({ kind: "bad" })).toThrow();
  });
});
