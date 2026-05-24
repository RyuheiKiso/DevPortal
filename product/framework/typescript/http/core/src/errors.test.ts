// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { HttpError, normalizeError, isRetryableError } from "./errors.js";
// 型を取り込み
import type { HttpRequest } from "./types.js";

// テスト用の HttpRequest 雛形（requestId を任意に上書き可能）
function makeReq(requestId = "req-1"): HttpRequest {
  return {
    url: "https://example.com/x",
    method: "GET",
    headers: {},
    requestId,
  };
}

describe("HttpError", () => {
  // 必要フィールドが格納される
  it("init から各フィールドが反映される", () => {
    const cause = new Error("boom");
    const e = new HttpError({
      message: "fail",
      status: 503,
      code: "GATEWAY",
      retryable: true,
      requestId: "rid",
      cause,
    });
    expect(e.name).toBe("HttpError");
    expect(e.message).toBe("fail");
    expect(e.status).toBe(503);
    expect(e.code).toBe("GATEWAY");
    expect(e.retryable).toBe(true);
    expect(e.requestId).toBe("rid");
    expect(e.cause).toBe(cause);
  });
  // 任意フィールドは undefined のまま
  it("status / code / requestId / response / cause は任意", () => {
    const e = new HttpError({ message: "x", retryable: false });
    expect(e.status).toBeUndefined();
    expect(e.code).toBeUndefined();
    expect(e.requestId).toBeUndefined();
    expect(e.response).toBeUndefined();
    expect(e.cause).toBeUndefined();
  });
});

describe("normalizeError", () => {
  // HttpError 既存（requestId あり）は素通し
  it("既存 HttpError（requestId 設定済）は同一参照で素通し", () => {
    const original = new HttpError({
      message: "x",
      retryable: false,
      requestId: "orig",
    });
    expect(normalizeError(original, makeReq("req"))).toBe(original);
  });
  // HttpError 既存（requestId なし）は補完して新規生成
  it("既存 HttpError（requestId 未設定）は補完した新規 HttpError を返す", () => {
    const original = new HttpError({
      message: "x",
      retryable: true,
      status: 500,
      code: "X",
    });
    const out = normalizeError(original, makeReq("filled"));
    expect(out).not.toBe(original);
    expect(out.requestId).toBe("filled");
    expect(out.status).toBe(500);
    expect(out.code).toBe("X");
    expect(out.retryable).toBe(true);
    expect(out.message).toBe("x");
  });
  // AbortError は code:"ABORTED" / retryable:false
  it("DOMException(AbortError) は ABORTED に正規化", () => {
    const e = new DOMException("aborted by user", "AbortError");
    const out = normalizeError(e, makeReq("r"));
    expect(out.code).toBe("ABORTED");
    expect(out.retryable).toBe(false);
    expect(out.requestId).toBe("r");
    expect(out.cause).toBe(e);
  });
  // TimeoutError は code:"TIMEOUT"
  it("DOMException(TimeoutError) は TIMEOUT に正規化", () => {
    const e = new DOMException("deadline", "TimeoutError");
    const out = normalizeError(e, makeReq("r"));
    expect(out.code).toBe("TIMEOUT");
    expect(out.retryable).toBe(false);
  });
  // TypeError は NETWORK / retryable:true
  it("TypeError は NETWORK に正規化（retryable=true）", () => {
    const e = new TypeError("fetch failed");
    const out = normalizeError(e, makeReq("r"));
    expect(out.code).toBe("NETWORK");
    expect(out.retryable).toBe(true);
    expect(out.message).toBe("fetch failed");
  });
  // message プロパティを持つオブジェクト
  it("message を持つ未知のオブジェクトはそのメッセージを使う", () => {
    const out = normalizeError({ message: "custom" }, makeReq("r"));
    expect(out.code).toBe("UNKNOWN");
    expect(out.retryable).toBe(false);
    expect(out.message).toBe("custom");
  });
  // プリミティブ
  it("プリミティブ（文字列など）は String 化される", () => {
    const out = normalizeError("plain", makeReq("r"));
    expect(out.message).toBe("plain");
    expect(out.code).toBe("UNKNOWN");
  });
});

describe("isRetryableError", () => {
  // status が retryable リストに含まれる場合は true
  it("HttpError かつ status が retryableStatuses に含まれれば true", () => {
    const e = new HttpError({ message: "x", retryable: false, status: 503 });
    expect(isRetryableError(e, [500, 503])).toBe(true);
  });
  // status が含まれなくても retryable=true なら true
  it("status 不一致でも retryable フラグが true なら true", () => {
    const e = new HttpError({ message: "x", retryable: true, status: 400 });
    expect(isRetryableError(e, [500])).toBe(true);
  });
  // status 不一致かつ retryable=false なら false
  it("status 不一致かつ retryable=false なら false", () => {
    const e = new HttpError({ message: "x", retryable: false, status: 400 });
    expect(isRetryableError(e, [500])).toBe(false);
  });
  // status が undefined なら retryable に従う
  it("status 未設定なら retryable フラグに従う", () => {
    const e = new HttpError({ message: "x", retryable: true });
    expect(isRetryableError(e, [500])).toBe(true);
  });
  // 非 HttpError は常に false
  it("非 HttpError は常に false", () => {
    expect(isRetryableError(new Error("x"), [500])).toBe(false);
    expect(isRetryableError("plain", [500])).toBe(false);
  });
});
