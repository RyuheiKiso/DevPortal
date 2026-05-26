// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// 公開 API 経由で HTTP 関連ロジックを取り込み
import { fromHttpError, isHttpErrorLike } from "./index.js";

// isHttpErrorLike の分岐網羅
describe("isHttpErrorLike", () => {
  // status を持つ object は HTTP 系
  it("returns true when status is present", () => {
    expect(isHttpErrorLike({ status: 500 })).toBe(true);
  });

  // statusCode を持つ object も HTTP 系（axios 等）
  it("returns true when statusCode is present", () => {
    expect(isHttpErrorLike({ statusCode: 404 })).toBe(true);
  });

  // response (record) を持てば HTTP 系
  it("returns true when response is a record", () => {
    expect(isHttpErrorLike({ response: { status: 404 } })).toBe(true);
  });

  // status などを持たないと HTTP 系ではない
  it("returns false when no HTTP markers are present", () => {
    expect(isHttpErrorLike({ requestId: "req-only" })).toBe(false);
    expect(isHttpErrorLike({})).toBe(false);
  });

  // object 以外は HTTP 系ではない
  it("returns false for non-object inputs", () => {
    expect(isHttpErrorLike("boom")).toBe(false);
    expect(isHttpErrorLike(null)).toBe(false);
    expect(isHttpErrorLike(undefined)).toBe(false);
    expect(isHttpErrorLike(500)).toBe(false);
  });
});

// fromHttpError の挙動を検証する
describe("fromHttpError", () => {
  // 上位 status と details を採用するパス
  it("normalizes top-level status and details", () => {
    const error = fromHttpError({
      message: "Request failed",
      status: 422,
      code: "INVALID_CUSTOMER",
      requestId: "req-1",
      details: { field: "name" },
    });

    expect(error.kind).toBe("validation");
    expect(error.status).toBe(422);
    expect(error.requestId).toBe("req-1");
    expect(error.code).toBe("INVALID_CUSTOMER");
    expect(error.details).toEqual({ field: "name" });
  });

  // statusCode を見るパス
  it("falls back to statusCode when status is missing", () => {
    const error = fromHttpError({ statusCode: 429 });
    expect(error.status).toBe(429);
    expect(error.kind).toBe("http");
    expect(error.retryable).toBe(true);
  });

  // response.status を見るパス
  it("falls back to response.status when top-level status is missing", () => {
    const error = fromHttpError({ response: { status: 503 } });
    expect(error.status).toBe(503);
    expect(error.kind).toBe("system");
  });

  // response.body を details に使うパス
  it("uses response.body when details is missing", () => {
    const error = fromHttpError({ status: 500, response: { body: { detail: "boom" } } });
    expect(error.details).toEqual({ detail: "boom" });
  });

  // response.data を details に使うパス (body が undefined)
  it("uses response.data when details and body are missing", () => {
    const error = fromHttpError({ status: 500, response: { data: { detail: "axios" } } });
    expect(error.details).toEqual({ detail: "axios" });
  });

  // plain object headers から大小文字違いで request-id を取り出す
  it("reads request-id and traceparent from plain object headers", () => {
    const error = fromHttpError({
      statusCode: 429,
      response: {
        headers: {
          "x-request-id": "req-from-header",
          traceparent: "trace-from-header",
        },
      },
    });
    expect(error.requestId).toBe("req-from-header");
    expect(error.traceId).toBe("trace-from-header");
  });

  // Web Headers クラスから大小文字違いで取り出す
  it("reads request-id from Web Headers", () => {
    const headers = new Headers({ "X-Request-Id": "req-web", traceparent: "trace-web" });
    const error = fromHttpError({
      response: {
        status: 504,
        headers,
      },
    });

    expect(error.kind).toBe("timeout");
    expect(error.requestId).toBe("req-web");
    expect(error.traceId).toBe("trace-web");
  });

  // Headers にキーが無ければ undefined を返す
  it("returns undefined when key is missing from Web Headers", () => {
    const error = fromHttpError({
      status: 500,
      response: { headers: new Headers() },
    });
    expect(error.requestId).toBeUndefined();
    expect(error.traceId).toBeUndefined();
  });

  // plain object headers にキーがあっても string でなければ undefined を返す
  it("returns undefined when plain header value is not a string", () => {
    const error = fromHttpError({
      status: 500,
      // 型上は禁止だが実行時に数値が混入するケースに備えてキャストで渡す
      response: { headers: { "x-request-id": 12345 as unknown as string } },
    });
    expect(error.requestId).toBeUndefined();
  });

  // headers が non-record / non-Headers (例えば数値) の場合は undefined を返す
  it("ignores headers that are neither Headers nor records", () => {
    const error = fromHttpError({
      status: 500,
      // 型上は禁止だが実行時に来る可能性に備えてキャストで渡す
      response: { headers: 42 as unknown as undefined },
    });
    expect(error.requestId).toBeUndefined();
  });

  // Web Headers が空文字列値を持つ場合は採用せず、context fallback に進む（B2 回帰防止）
  it("treats empty Web Headers values as missing and falls back to context", () => {
    // 空文字列ヘッダは「意味の無い値」として弾き、context.requestId に進めるべき
    const headers = new Headers({ "x-request-id": "", traceparent: "" });
    const error = fromHttpError(
      { status: 500, response: { headers } },
      { requestId: "ctx-req", traceId: "ctx-trace" },
    );
    expect(error.requestId).toBe("ctx-req");
    expect(error.traceId).toBe("ctx-trace");
  });

  // plain object headers が空文字列値を持つ場合も同様にフォールバックする（B2 回帰防止）
  it("treats empty plain header values as missing and falls back to context", () => {
    const error = fromHttpError(
      { status: 500, response: { headers: { "x-request-id": "", traceparent: "" } } },
      { requestId: "ctx-req", traceId: "ctx-trace" },
    );
    expect(error.requestId).toBe("ctx-req");
    expect(error.traceId).toBe("ctx-trace");
  });

  // error.requestId / error.traceId / error.code が空文字列の場合も弾く（B2 回帰防止）
  it("treats empty top-level string fields as missing and falls back to headers/context", () => {
    const error = fromHttpError(
      {
        status: 500,
        // 上位プロパティはいずれも空文字列で「実質未指定」
        requestId: "",
        traceId: "",
        code: "",
        response: { headers: { "x-request-id": "hdr-req", traceparent: "hdr-trace" } },
      },
      { requestId: "ctx-req", traceId: "ctx-trace" },
    );
    // header 由来の値に進める
    expect(error.requestId).toBe("hdr-req");
    expect(error.traceId).toBe("hdr-trace");
    // code は空文字列なら採用せず undefined のまま
    expect(error.code).toBeUndefined();
  });

  // error.message が空文字列ならデフォルトテンプレに切り替える（B3 回帰防止）
  it("falls back to default message template when error.message is an empty string", () => {
    const error = fromHttpError({ message: "", status: 503 });
    expect(error.message).toBe("HTTP request failed with status 503");
  });

  // status 無し / code から kind 推定するパス
  it("uses code to classify kind when status is missing", () => {
    const error = fromHttpError({ code: "ETIMEDOUT" });
    expect(error.kind).toBe("timeout");
  });

  // status 無し / code 無し → http fallback、status 含まないメッセージテンプレ
  it("falls back to http kind and uses status-less message when neither status nor code helps", () => {
    const error = fromHttpError({});
    expect(error.kind).toBe("http");
    expect(error.message).toBe("HTTP request failed");
  });

  // status 有り且つ message 未指定 → メッセージテンプレに status が入る
  it("includes status in default message when status is present", () => {
    const error = fromHttpError({ status: 502 });
    expect(error.message).toBe("HTTP request failed with status 502");
  });

  // context fallback で request-id / trace-id を埋める
  it("uses context fallback for request-id and trace-id", () => {
    const error = fromHttpError({ status: 500 }, { requestId: "ctx-req", traceId: "ctx-trace" });
    expect(error.requestId).toBe("ctx-req");
    expect(error.traceId).toBe("ctx-trace");
  });

  // cause が無ければ undefined のまま（自己参照しない）
  it("does not self-reference when cause is missing", () => {
    const error = fromHttpError({ status: 500 });
    expect(error.cause).toBeUndefined();
  });

  // cause が指定されていればそれを保持
  it("keeps explicit cause", () => {
    const innerCause = new Error("inner");
    const error = fromHttpError({ status: 500, cause: innerCause });
    expect(error.cause).toBe(innerCause);
  });

  // response.body 内の zod 風 issues を validationIssues に併設する
  // status 由来で kind=validation に分類されつつ、status / requestId / traceId / details も保持される
  it("attaches validationIssues from response body while keeping HTTP metadata", () => {
    const error = fromHttpError({
      status: 422,
      requestId: "req-1",
      response: {
        headers: { traceparent: "trace-from-header" },
        body: { issues: [{ path: ["name"], code: "too_small", message: "Name is required" }] },
      },
    });

    // kind は status 由来で validation
    expect(error.kind).toBe("validation");
    // status / requestId / traceId は失われない
    expect(error.status).toBe(422);
    expect(error.requestId).toBe("req-1");
    expect(error.traceId).toBe("trace-from-header");
    // body の issues が validationIssues に併設される
    expect(error.validationIssues).toEqual([
      { path: ["name"], code: "too_small", message: "Name is required" },
    ]);
    // 既存 details 解決 (body → data → ...) で body 全体が details として残る
    expect(error.details).toEqual({ issues: [{ path: ["name"], code: "too_small", message: "Name is required" }] });
  });

  // response.data 内の issues を validationIssues に併設する（axios 経路）
  it("attaches validationIssues from response.data when body is missing", () => {
    const error = fromHttpError({
      status: 200,
      response: { data: { issues: [{ message: "axios issue" }] } },
    });
    // status=200 は http kind にフォールバック
    expect(error.kind).toBe("http");
    // data 由来 issues も validationIssues に併設される
    expect(error.validationIssues).toEqual([{ path: undefined, code: undefined, message: "axios issue" }]);
  });

  // error 自身に issues 配列がある場合（response が無い経路）も拾える
  it("falls back to error-level issues when no response body or data is present", () => {
    const error = fromHttpError({
      status: 422,
      // 型上は HttpErrorLike に issues プロパティは無いが、unknown フィールドとして実行時に来るケース
      ...({ issues: [{ message: "top-level issue" }] } as Record<string, unknown>),
    });
    expect(error.validationIssues?.[0]?.message).toBe("top-level issue");
  });

  // 全 issue が無効形なら validationIssues は undefined のまま（空配列を併設しない）
  it("leaves validationIssues undefined when no valid issues are present", () => {
    const error = fromHttpError({
      status: 500,
      response: { body: { issues: [{ code: "no-message" }, null] } },
    });
    expect(error.validationIssues).toBeUndefined();
  });
});
