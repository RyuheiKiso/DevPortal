// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// 公開 API 経由で分類関数を取り込み
import { classifyErrorCode, classifyHttpStatus } from "./index.js";

// HTTP status の分類を検証する
describe("classifyHttpStatus", () => {
  // 0 は fetch がコネクション失敗時に返す値
  it("treats status 0 as network", () => {
    expect(classifyHttpStatus(0)).toBe("network");
  });

  // タイムアウト系
  it("classifies timeout statuses", () => {
    expect(classifyHttpStatus(408)).toBe("timeout");
    expect(classifyHttpStatus(504)).toBe("timeout");
  });

  // バリデーション系
  it("classifies validation statuses", () => {
    expect(classifyHttpStatus(400)).toBe("validation");
    expect(classifyHttpStatus(422)).toBe("validation");
  });

  // 認証・認可
  it("classifies auth and permission statuses", () => {
    expect(classifyHttpStatus(401)).toBe("auth");
    expect(classifyHttpStatus(403)).toBe("permission");
  });

  // not found
  it("classifies not-found status", () => {
    expect(classifyHttpStatus(404)).toBe("notFound");
  });

  // 競合
  it("classifies conflict statuses", () => {
    expect(classifyHttpStatus(409)).toBe("conflict");
    expect(classifyHttpStatus(412)).toBe("conflict");
  });

  // 5xx は system
  it("classifies 5xx as system", () => {
    expect(classifyHttpStatus(500)).toBe("system");
    expect(classifyHttpStatus(599)).toBe("system");
  });

  // どれにも該当しない 4xx は汎用 http
  it("falls back to http for unspecified codes", () => {
    expect(classifyHttpStatus(418)).toBe("http");
    expect(classifyHttpStatus(200)).toBe("http");
  });
});

// エラーコード文字列の分類を検証する
describe("classifyErrorCode", () => {
  // 未指定 code は分類しない
  it("returns undefined for undefined input", () => {
    expect(classifyErrorCode(undefined)).toBeUndefined();
  });

  // 通信系 code
  it("classifies timeout and network codes", () => {
    expect(classifyErrorCode("ETIMEDOUT")).toBe("timeout");
    expect(classifyErrorCode("REQUEST_TIMEOUT")).toBe("timeout");
    expect(classifyErrorCode("NETWORK_ERROR")).toBe("network");
    expect(classifyErrorCode("ECONNREFUSED")).toBe("network");
    expect(classifyErrorCode("ENOTFOUND")).toBe("network");
  });

  // 入力検証系 code
  it("classifies validation codes", () => {
    expect(classifyErrorCode("VALIDATION_FAILED")).toBe("validation");
    expect(classifyErrorCode("INVALID_INPUT")).toBe("validation");
  });

  // 認証・認可系 code
  it("classifies auth and permission codes", () => {
    expect(classifyErrorCode("UNAUTHORIZED")).toBe("auth");
    expect(classifyErrorCode("AUTH_FAILED")).toBe("auth");
    expect(classifyErrorCode("PERMISSION_DENIED")).toBe("permission");
    expect(classifyErrorCode("FORBIDDEN")).toBe("permission");
  });

  // 競合系 code
  it("classifies conflict codes", () => {
    expect(classifyErrorCode("VERSION_CONFLICT")).toBe("conflict");
  });

  // 未検出系 code
  it("classifies not-found codes", () => {
    expect(classifyErrorCode("CUSTOMER_NOT_FOUND")).toBe("notFound");
    expect(classifyErrorCode("notfound")).toBe("notFound");
  });

  // 未分類 code は呼び出し側に判断を委ねる
  it("returns undefined for unrelated codes", () => {
    expect(classifyErrorCode("SOME_BUSINESS_RULE")).toBeUndefined();
  });

  // token 完全一致なので "AUTHOR_NAME" のような部分一致は誤分類しない
  it("does not misclassify substrings that resemble known tokens", () => {
    // AUTHOR は auth ではない（部分一致を弾く）
    expect(classifyErrorCode("AUTHOR_NAME")).toBeUndefined();
    // PERMITTED は permission ではない
    expect(classifyErrorCode("PERMITTED")).toBeUndefined();
    // CONFLICTED は conflict 系として扱う
    expect(classifyErrorCode("CONFLICTED")).toBe("conflict");
    // UNAUTHENTICATED は auth として扱う
    expect(classifyErrorCode("UNAUTHENTICATED")).toBe("auth");
    // ハイフン区切りでも token 化される
    expect(classifyErrorCode("auth-failed")).toBe("auth");
  });
});
