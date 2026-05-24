// vitest DSL を取り込み
import { afterEach, describe, expect, it, vi } from "vitest";
// テスト対象
import { createHttpClient } from "./client.js";
// 関連 API / 型
import { HttpError } from "./errors.js";
import { REQUEST_ID_HEADER } from "./requestId.js";
import { createBearerAuth } from "./auth.js";
import type { Logger } from "./types.js";

// レスポンス生成ヘルパ（ok=true）
function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
// 非 ok レスポンス生成ヘルパ
function bad(status: number): Response {
  return new Response("err", { status });
}
// 計測用 Logger
function spyLogger(): Logger & { calls: Array<[string, string, unknown]> } {
  const calls: Array<[string, string, unknown]> = [];
  return {
    debug: (m, c) => calls.push(["debug", m, c]),
    info: (m, c) => calls.push(["info", m, c]),
    warn: (m, c) => calls.push(["warn", m, c]),
    error: (m, c) => calls.push(["error", m, c]),
    calls,
  };
}

describe("createHttpClient.request", () => {
  // 各テスト後に global stub を解除
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // 基本: GET 成功
  it("最小設定で fetchImpl 注入から GET 成功", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({ ok: true }));
    const client = createHttpClient({ fetchImpl });
    const res = await client.request<{ ok: boolean }>({ url: "https://api/x" });
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // requestId が X-Request-Id に乗っていること
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers[REQUEST_ID_HEADER]).toBeDefined();
  });

  // baseUrl + path + query
  it("baseUrl と path を連結し query を付与", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      baseUrl: "https://api.example.com/",
      fetchImpl,
    });
    await client.request({
      url: "users",
      query: { a: 1, b: ["x", "y"], c: null, d: undefined },
    });
    const url = fetchImpl.mock.calls[0]?.[0] as string;
    expect(url).toBe("https://api.example.com/users?a=1&b=x&b=y");
  });

  // 絶対 URL は素通し
  it("absolute URL は baseUrl を無視", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ baseUrl: "https://api/", fetchImpl });
    await client.request({ url: "https://other.example.com/x" });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://other.example.com/x");
  });

  // baseUrl 無指定で path のみ
  it("baseUrl 無指定でも path をそのまま使う", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ fetchImpl });
    await client.request({ url: "/local/path" });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/local/path");
  });

  // defaultHeaders + 個別 headers
  it("defaultHeaders と個別 headers をマージ", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      defaultHeaders: { "X-A": "1", "X-B": "x" },
      fetchImpl,
    });
    await client.request({ url: "/x", headers: { "X-B": "y", "X-C": "3" } });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["X-A"]).toBe("1");
    expect(headers["X-B"]).toBe("y");
    expect(headers["X-C"]).toBe("3");
  });

  // auth が headers に追加される
  it("auth.getAuthHeaders の結果がヘッダに追加される", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      auth: createBearerAuth(() => "abc"),
      fetchImpl,
    });
    await client.request({ url: "/x" });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer abc");
  });

  // request interceptor が呼ばれる
  it("request interceptor が順次適用される", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      requestInterceptors: [
        (r) => ({ ...r, headers: { ...r.headers, "X-Int": "1" } }),
      ],
    });
    await client.request({ url: "/x" });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["X-Int"]).toBe("1");
  });

  // response interceptor が呼ばれる
  it("response interceptor で status を書き換えできる", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      responseInterceptors: [(r) => ({ ...r, status: 299 })],
    });
    const res = await client.request({ url: "/x" });
    expect(res.status).toBe(299);
  });

  // !ok は HttpError として throw
  it("!ok レスポンスは HttpError として throw（status / retryable 含む）", async () => {
    const fetchImpl = vi.fn(async () => bad(404));
    const client = createHttpClient({ fetchImpl, retry: { maxRetries: 0 } });
    await expect(client.request({ url: "/x" })).rejects.toMatchObject({
      status: 404,
    });
  });

  // 5xx でリトライ
  it("503 でリトライ後に成功", async () => {
    vi.useFakeTimers();
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i++;
      return i === 1 ? bad(503) : jsonOk({ ok: true });
    });
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 2, backoffBaseMs: 1, jitter: "none" },
    });
    const p = client.request({ url: "/x" });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // generateRequestId 注入
  it("generateRequestId 注入で固定 ID を使う", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      generateRequestId: () => "fixed-id",
    });
    const res = await client.request({ url: "/x" });
    expect(res.request.requestId).toBe("fixed-id");
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers[REQUEST_ID_HEADER]).toBe("fixed-id");
  });

  // logger に 4 種すべて呼ばれる
  it("logger.debug / info / warn / error が呼ばれる", async () => {
    vi.useFakeTimers();
    const logger = spyLogger();
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i++;
      return i === 1 ? bad(503) : jsonOk({});
    });
    const client = createHttpClient({
      fetchImpl,
      logger,
      retry: { maxRetries: 1, backoffBaseMs: 1, jitter: "none" },
    });
    const p = client.request({ url: "/x" });
    await vi.advanceTimersByTimeAsync(10);
    await p;
    const types = logger.calls.map((c) => c[0]);
    expect(types).toContain("debug");
    expect(types).toContain("warn");
    expect(types).toContain("info");
  });

  // error log の経路（全失敗）
  it("最終失敗時に logger.error が呼ばれる", async () => {
    vi.useFakeTimers();
    const logger = spyLogger();
    const fetchImpl = vi.fn(async () => bad(503));
    const client = createHttpClient({
      fetchImpl,
      logger,
      retry: { maxRetries: 1, backoffBaseMs: 1, jitter: "none" },
    });
    const p = client.request({ url: "/x" }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    await p;
    expect(logger.calls.some((c) => c[0] === "error")).toBe(true);
  });

  // error interceptor が呼ばれる
  it("error interceptor が throw で伝播", async () => {
    const fetchImpl = vi.fn(async () => bad(500));
    const errSeen: unknown[] = [];
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 0 },
      errorInterceptors: [
        (e) => {
          errSeen.push(e);
          throw new Error("intercepted");
        },
      ],
    });
    await expect(client.request({ url: "/x" })).rejects.toThrow("intercepted");
    expect(errSeen[0]).toBeInstanceOf(HttpError);
  });

  // ネットワークエラー（TypeError）→ NETWORK
  it("fetch が TypeError を投げた場合 NETWORK コードになる", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("connection refused");
    });
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 0 },
    });
    await expect(client.request({ url: "/x" })).rejects.toMatchObject({
      code: "NETWORK",
    });
  });

  // withConfig: 派生クライアントの設定
  it("withConfig で baseUrl 上書き", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const c1 = createHttpClient({ baseUrl: "https://a", fetchImpl });
    const c2 = c1.withConfig({ baseUrl: "https://b" });
    await c2.request({ url: "/x" });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://b/x");
    // 元クライアントは影響を受けない
    expect(c1.config.baseUrl).toBe("https://a");
    expect(c2.config.baseUrl).toBe("https://b");
  });

  // withConfig: interceptor は連結される
  it("withConfig で interceptor を連結", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const order: string[] = [];
    const c1 = createHttpClient({
      fetchImpl,
      requestInterceptors: [
        (r) => {
          order.push("base");
          return r;
        },
      ],
    });
    const c2 = c1.withConfig({
      requestInterceptors: [
        (r) => {
          order.push("override");
          return r;
        },
      ],
    });
    await c2.request({ url: "/x" });
    expect(order).toEqual(["base", "override"]);
  });

  // fetchImpl 未指定で globalThis.fetch を使う
  it("fetchImpl 未指定で globalThis.fetch を使う", async () => {
    const original = globalThis.fetch;
    const spy = vi.fn(async () => jsonOk({}));
    vi.stubGlobal("fetch", spy);
    try {
      const client = createHttpClient({});
      await client.request({ url: "https://api/x" });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal("fetch", original);
    }
  });

  // method 既定 GET
  it("method 未指定なら GET", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ fetchImpl });
    await client.request({ url: "/x" });
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  // query 未指定なら ? なし
  it("query 未指定なら URL に ? を付けない", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ baseUrl: "https://a", fetchImpl });
    await client.request({ url: "/x" });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://a/x");
  });

  // query が全 null/undefined なら ? なし
  it("query 全要素が null/undefined なら ? を付けない", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ baseUrl: "https://a", fetchImpl });
    await client.request({ url: "/x", query: { a: null, b: undefined } });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://a/x");
  });

  // meta フィールドが req に格納される
  it("meta が HttpRequest に格納される", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    let seenMeta: unknown = undefined;
    const client = createHttpClient({
      fetchImpl,
      requestInterceptors: [
        (r) => {
          seenMeta = r.meta;
          return r;
        },
      ],
    });
    await client.request({ url: "/x", meta: { trace: "abc" } });
    expect(seenMeta).toEqual({ trace: "abc" });
  });
});
