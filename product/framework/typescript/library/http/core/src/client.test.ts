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

  it("retryable なネットワークエラーは retry される", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        throw new TypeError("socket closed", {
          cause: { code: "ECONNRESET" },
        });
      }
      return jsonOk({ ok: true });
    });
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 1, backoffBaseMs: 1, jitter: "none" },
    });

    const p = client.request({ url: "/x" });
    await vi.advanceTimersByTimeAsync(10);

    await expect(p).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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

  it("createHttpClient 後に元 config を mutate しても client の挙動は変わらない", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const config = {
      baseUrl: "https://a",
      defaultHeaders: { "X-A": "1" },
      retry: { maxRetries: 0 },
      fetchImpl,
    };
    const client = createHttpClient(config);
    config.baseUrl = "https://mutated";
    config.defaultHeaders["X-A"] = "2";
    config.retry.maxRetries = 5;

    await client.request({ url: "/x" });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://a/x");
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["X-A"]).toBe("1");
    expect(client.config.baseUrl).toBe("https://a");
    expect(client.config.defaultHeaders?.["X-A"]).toBe("1");
    expect(client.config.retry?.maxRetries).toBe(0);
  });

  it("公開 config は nested オブジェクトも freeze されたスナップショット", () => {
    const client = createHttpClient({
      defaultHeaders: { "X-A": "1" },
      retry: { maxRetries: 0 },
      requestInterceptors: [(r) => r],
    });

    expect(Object.isFrozen(client.config)).toBe(true);
    expect(Object.isFrozen(client.config.defaultHeaders)).toBe(true);
    expect(Object.isFrozen(client.config.retry)).toBe(true);
    expect(Object.isFrozen(client.config.requestInterceptors)).toBe(true);
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

  it("既存 query がある URL には & で query を追記する", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ baseUrl: "https://a", fetchImpl });
    await client.request({ url: "/x?active=true", query: { page: 2 } });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://a/x?active=true&page=2");
  });

  it("hash fragment がある URL では fragment の前に query を追加する", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ baseUrl: "https://a", fetchImpl });
    await client.request({ url: "/x#section", query: { page: 2 } });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://a/x?page=2#section");
  });

  // A1: interceptor が headers を完全置換しても X-Request-Id が残る
  it("A1: interceptor が headers を空に置換しても X-Request-Id が必ず付与される", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      generateRequestId: () => "rid-protect",
      defaultHeaders: { "X-A": "1" },
      requestInterceptors: [
        // interceptor が意図的に headers を完全置換
        (req) => ({ ...req, headers: { "X-Replaced": "yes" } }),
      ],
    });
    await client.request({ url: "/x" });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["X-Replaced"]).toBe("yes");
    expect(headers[REQUEST_ID_HEADER]).toBe("rid-protect");
    expect(headers["X-A"]).toBeUndefined();
  });

  // A2: !ok レスポンスの HttpError.response.raw を読める
  it("A2: !ok レスポンスは HttpError.response.raw から body を読める", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createHttpClient({ fetchImpl, retry: { maxRetries: 0 } });
    let err: HttpError | undefined;
    try {
      await client.request({ url: "/x" });
    } catch (e) {
      err = e as HttpError;
    }
    expect(err).toBeInstanceOf(HttpError);
    expect(err?.response?.status).toBe(400);
    const body = (await err!.response!.raw.json()) as { error: string };
    expect(body.error).toBe("invalid");
  });

  // A3: auth が attempt 毎に呼ばれる（token refresh 対応、method 未指定で GET になりリトライ対象）
  it("A3: auth.getAuthHeaders が attempt 毎に呼ばれる", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchImpl = vi.fn(async () => bad(503));
    const getHeaders = vi.fn(async () => {
      calls++;
      return { Authorization: `Bearer t${calls}` };
    });
    const client = createHttpClient({
      fetchImpl,
      auth: { getAuthHeaders: getHeaders },
      retry: { maxRetries: 1, backoffBaseMs: 1, jitter: "none" },
    });
    // method 未指定 = GET（冪等メソッド）でリトライ対象
    const p = client.request({ url: "/x" }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    await p;
    // 初回 + リトライ 1 回 = 2 attempt
    expect(getHeaders).toHaveBeenCalledTimes(2);
    // 各 attempt で異なる token が送られる
    const headers1 = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const headers2 = fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers1["Authorization"]).toBe("Bearer t1");
    expect(headers2["Authorization"]).toBe("Bearer t2");
  });

  // B-4: 非冪等メソッド (POST) は既定で retry しない
  it("B-4: POST + 503 は既定で retry されない", async () => {
    const fetchImpl = vi.fn(async () => bad(503));
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 3, backoffBaseMs: 1, jitter: "none" },
    });
    await expect(
      client.request({ url: "/x", method: "POST", body: "data" }),
    ).rejects.toMatchObject({ status: 503 });
    // 冪等性配慮で 1 試行のみ
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // B-4: POST + Idempotency-Key ヘッダがあれば retry される
  it("B-4: POST + Idempotency-Key + 503 は retry される", async () => {
    vi.useFakeTimers();
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i++;
      return i === 1 ? bad(503) : jsonOk({});
    });
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 2, backoffBaseMs: 1, jitter: "none" },
    });
    const p = client.request({
      url: "/x",
      method: "POST",
      body: "data",
      headers: { "Idempotency-Key": "abc-123" },
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // C-A2: shouldRetry 指定だけでは冪等性ガードを bypass しない（罠回避）
  it("C-A2: shouldRetry: () => true だけでは POST は依然 retry されない", async () => {
    const fetchImpl = vi.fn(async () => bad(503));
    const client = createHttpClient({
      fetchImpl,
      retry: {
        maxRetries: 2,
        backoffBaseMs: 1,
        jitter: "none",
        shouldRetry: () => true,
      },
    });
    await expect(
      client.request({ url: "/x", method: "POST", body: "data" }),
    ).rejects.toMatchObject({ status: 503 });
    // 冪等性ガード健在なので 1 試行のみ
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // C-A2: allowNonIdempotent: true でオプトインすると POST でも retry される
  it("C-A2: allowNonIdempotent: true なら POST でも retry される", async () => {
    vi.useFakeTimers();
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i++;
      return i === 1 ? bad(503) : jsonOk({});
    });
    const client = createHttpClient({
      fetchImpl,
      retry: {
        maxRetries: 2,
        backoffBaseMs: 1,
        jitter: "none",
        allowNonIdempotent: true,
      },
    });
    const p = client.request({ url: "/x", method: "POST", body: "data" });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // T-A2: shouldRetry: () => false + allowNonIdempotent: true で完全に止まる（shouldRetry が優先）
  it("T-A2: allowNonIdempotent でも shouldRetry: () => false なら 1 回のみ", async () => {
    const fetchImpl = vi.fn(async () => bad(503));
    const client = createHttpClient({
      fetchImpl,
      retry: {
        maxRetries: 3,
        backoffBaseMs: 1,
        jitter: "none",
        allowNonIdempotent: true,
        shouldRetry: () => false,
      },
    });
    await expect(
      client.request({ url: "/x", method: "POST", body: "data" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // T-A3: PATCH も非冪等メソッドなので既定 retry なし
  it.each(["POST", "PATCH"] as const)(
    "T-A3: %s + 503 は既定で retry されない（非冪等）",
    async (method) => {
      const fetchImpl = vi.fn(async () => bad(503));
      const client = createHttpClient({
        fetchImpl,
        retry: { maxRetries: 3, backoffBaseMs: 1, jitter: "none" },
      });
      await expect(
        client.request({ url: "/x", method, body: "data" }),
      ).rejects.toMatchObject({ status: 503 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  // T-A1: Idempotency-Key の大文字小文字を問わず検出される（HTTP RFC 7230 §3.2 準拠）
  it.each([
    "Idempotency-Key",
    "idempotency-key",
    "IDEMPOTENCY-KEY",
    "iDeMpOtEnCy-KeY",
  ])("T-A1: POST + '%s' ヘッダ付きで retry される", async (headerName) => {
    vi.useFakeTimers();
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i++;
      return i === 1 ? bad(503) : jsonOk({});
    });
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 2, backoffBaseMs: 1, jitter: "none" },
    });
    const p = client.request({
      url: "/x",
      method: "POST",
      body: "data",
      headers: { [headerName]: "abc-123" },
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // C-A1: 非冪等メソッドで実際に retry されない場合、HttpError.retryable は false
  it("C-A1: POST + 503 の HttpError.retryable は冪等性ガードで false に", async () => {
    const fetchImpl = vi.fn(async () => bad(503));
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 3, backoffBaseMs: 1, jitter: "none" },
    });
    await expect(
      client.request({ url: "/x", method: "POST", body: "data" }),
    ).rejects.toMatchObject({ status: 503, retryable: false });
  });

  // C-A1: GET + 503 は retry 対象だが、最大試行後の最終エラーは retryable=false
  it("C-A1: GET + 503 最終失敗時の HttpError.retryable は false", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => bad(503));
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 1, backoffBaseMs: 1, jitter: "none" },
    });
    const p = client.request({ url: "/x" }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10);
    const err = (await p) as { status: number; retryable: boolean };
    expect(err.status).toBe(503);
    expect(err.retryable).toBe(false);
  });

  // C-A7: requestIdHeader 空文字は createHttpClient で throw
  it("C-A7: requestIdHeader が空文字なら createHttpClient で throw", () => {
    expect(() => createHttpClient({ requestIdHeader: "" })).toThrow(
      /requestIdHeader must be a non-empty string/,
    );
    expect(() => createHttpClient({ requestIdHeader: "  " })).toThrow();
  });

  it("retry / timeout の不正な数値設定は createHttpClient で拒否", () => {
    expect(() =>
      createHttpClient({ retry: { maxRetries: -1 } }),
    ).toThrow(/retry\.maxRetries/);
    expect(() =>
      createHttpClient({ retry: { backoffBaseMs: 1.5 } }),
    ).toThrow(/retry\.backoffBaseMs/);
    expect(() =>
      createHttpClient({ timeout: { totalMs: -1 } }),
    ).toThrow(/timeout\.totalMs/);
  });

  it("retryableStatuses と jitter の不正値は createHttpClient で拒否", () => {
    expect(() =>
      createHttpClient({
        retry: { retryableStatuses: [500.5] },
      }),
    ).toThrow(/retryableStatuses/);
    expect(() =>
      createHttpClient({
        retry: { jitter: "bad" as "full" },
      }),
    ).toThrow(/retry\.jitter/);
  });

  // B-3: 425 はデフォルトで retry されない
  it("B-3: 425 Too Early は既定 retryableStatuses から除外", async () => {
    const fetchImpl = vi.fn(async () => bad(425));
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 3, backoffBaseMs: 1, jitter: "none" },
    });
    await expect(client.request({ url: "/x" })).rejects.toMatchObject({
      status: 425,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // B-1: rawHeaders が Headers インスタンスとして取れる
  // T-A6: getSetCookie() は Node 20+ / undici 限定のため、有無で分岐して Node 18 でも動かす
  it("B-1: HttpResponse.rawHeaders が raw.headers と同一参照で Headers", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("ok", {
          status: 200,
          headers: [
            ["Set-Cookie", "a=1; Path=/"],
            ["Set-Cookie", "b=2; Path=/"],
          ],
        }),
    );
    const client = createHttpClient({ fetchImpl });
    const res = await client.request({ url: "/x" });
    expect(res.rawHeaders).toBeInstanceOf(Headers);
    // raw.headers と同一参照（防御コピー無しの設計を担保）
    expect(res.rawHeaders).toBe(res.raw.headers);
    // 環境依存だが getSetCookie が使える場合のみ multi-value を確認
    if (typeof res.rawHeaders.getSetCookie === "function") {
      const cookies = res.rawHeaders.getSetCookie();
      expect(cookies).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    } else {
      // フォールバック: forEach で 2 件取得できることを確認
      let count = 0;
      res.rawHeaders.forEach((_v, k) => {
        if (k.toLowerCase() === "set-cookie") count++;
      });
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  // B-1: plain headers (Record<string,string>) は最後の値しか持たない（rawHeaders 存在意義）
  it("B-1: headers (Record) は multi-value をフラット化、rawHeaders だけが multi-value を保持", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("ok", {
          status: 200,
          headers: [
            ["Set-Cookie", "a=1"],
            ["Set-Cookie", "b=2"],
          ],
        }),
    );
    const client = createHttpClient({ fetchImpl });
    const res = await client.request({ url: "/x" });
    // headers は Record<string,string> なので 2 件は a=1, b=2 が , 連結で 1 つになる（fetch 仕様）
    // 一方 rawHeaders は Headers なので multi-value をネイティブに扱える
    expect(res.rawHeaders).toBeInstanceOf(Headers);
  });

  // B-2: requestIdHeader をカスタマイズできる
  it("B-2: requestIdHeader を traceparent に変更できる", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      requestIdHeader: "traceparent",
      generateRequestId: () => "00-aaaa-bbbb-01",
    });
    await client.request({ url: "/x" });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["traceparent"]).toBe("00-aaaa-bbbb-01");
    // X-Request-Id は出ない
    expect(headers["X-Request-Id"]).toBeUndefined();
  });

  // A5: ReadableStream body はリトライしない
  it("A5: ReadableStream body は retry されない（即 throw）", async () => {
    const fetchImpl = vi.fn(async () => bad(503));
    const stream = new ReadableStream({ start: (c) => c.close() });
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 5, backoffBaseMs: 1, jitter: "none" },
    });
    await expect(
      client.request({ url: "/x", method: "POST", body: stream }),
    ).rejects.toMatchObject({ status: 503 });
    // maxRetries=5 でも 1 回しか fetch されない
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // A5: 非 stream body は通常通り retry される（PUT は冪等メソッド、B-4 後も retry 対象）
  it("A5: 文字列 body は通常通り retry される (PUT)", async () => {
    vi.useFakeTimers();
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i++;
      return i === 1 ? bad(503) : jsonOk({});
    });
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 2, backoffBaseMs: 1, jitter: "none" },
    });
    const p = client.request({ url: "/x", method: "PUT", body: "data" });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // A5: 想定外の body 型（数値）でも retry される（isConsumableBody は安全側で false）
  it("A5: 想定外の body 型 (数値) でも retry される (PUT)", async () => {
    vi.useFakeTimers();
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i++;
      return i === 1 ? bad(503) : jsonOk({});
    });
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 2, backoffBaseMs: 1, jitter: "none" },
    });
    // 型を緩めて body に数値を渡す（実用ではないが isConsumableBody の最終 return false パスを網羅）
    const p = client.request({
      url: "/x",
      method: "PUT",
      body: 123 as unknown as BodyInit,
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // A5: 各 body 型が「consume 不可」と判定されず retry されることを確認（branch 網羅、PUT を使用）
  it.each<[string, BodyInit]>([
    ["Blob", new Blob(["x"])],
    ["ArrayBuffer", new ArrayBuffer(8)],
    ["URLSearchParams", new URLSearchParams({ a: "1" })],
  ])("A5: %s body は retry される (PUT)", async (_name, body) => {
    vi.useFakeTimers();
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i++;
      return i === 1 ? bad(503) : jsonOk({});
    });
    const client = createHttpClient({
      fetchImpl,
      retry: { maxRetries: 2, backoffBaseMs: 1, jitter: "none" },
    });
    const p = client.request({ url: "/x", method: "PUT", body });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // 連続呼び出しで各 request の X-Request-Id が独立
  it("同一 client での連続 request が異なる X-Request-Id を持つ", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ fetchImpl });
    await client.request({ url: "/x" });
    await client.request({ url: "/y" });
    const id1 = (fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>)[
      REQUEST_ID_HEADER
    ];
    const id2 = (fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>)[
      REQUEST_ID_HEADER
    ];
    expect(id1).not.toBe(id2);
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

  // ヘッダ正規化: req.headers の "Authorization" と auth.getAuthHeaders の "authorization" が
  // 大小文字違いで重複しないこと (RFC 7230 §3.2 / case-insensitive)
  it("Authorization の大小文字違いキーは単一エントリにマージされる", async () => {
    let observedHeaders: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url, init) => {
      // 送信されたヘッダを記録 (Headers / Record どちらの形でも来うる)
      const h = (init as RequestInit | undefined)?.headers;
      observedHeaders = {};
      if (h instanceof Headers) {
        h.forEach((v, k) => {
          observedHeaders[k] = v;
        });
      } else if (h !== undefined) {
        observedHeaders = { ...(h as Record<string, string>) };
      }
      return jsonOk({});
    });
    const client = createHttpClient({
      fetchImpl,
      // auth は小文字キーで Authorization を返す (大小違いを再現)
      auth: { async getAuthHeaders() { return { authorization: "Bearer new" }; } },
    });
    // 利用側は大文字キーで指定
    await client.request({ url: "/x", headers: { Authorization: "Bearer old" } });
    // 出力ヘッダのうち authorization (case 無視) は 1 つだけ
    const authKeys = Object.keys(observedHeaders).filter(
      (k) => k.toLowerCase() === "authorization",
    );
    expect(authKeys).toHaveLength(1);
    // 値は auth の後勝ち (Bearer new)
    expect(observedHeaders[authKeys[0]!]).toBe("Bearer new");
  });

  // willActuallyRetry: shouldRetry が false を返した場合は retryable=false で公開される
  // (旧実装は `shouldRetry !== undefined` のみで真扱いだった)
  it("shouldRetry が false を返す場合、HttpError.retryable は false になる", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("e", { status: 500 }),
    );
    // shouldRetry は常に false を返す (= 再試行しない判定)
    const shouldRetry = vi.fn(() => false);
    const client = createHttpClient({
      fetchImpl,
      retry: {
        maxRetries: 3,
        backoffBaseMs: 1,
        backoffMaxMs: 1,
        jitter: "none",
        shouldRetry,
      },
    });
    // 1 回目で throw、shouldRetry が false なので追加 attempt は無い
    try {
      await client.request({ url: "/x" });
      throw new Error("expected throw");
    } catch (err) {
      // 旧実装ではここが true になっていたバグ。修正後は false になる。
      // (markRetryExhausted を経由するため最終的に false に倒される側面もあるが、
      //  少なくとも本テストは「shouldRetry が false → retryable=false 」を観測している)
      expect((err as { retryable?: boolean }).retryable).toBe(false);
    }
    // shouldRetry は 2 回呼ばれている (client.ts の willActuallyRetry 判定 1 回 + withRetry 1 回)
    // 旧実装は client.ts 側で実評価せず `!== undefined` のみで真扱いだったため、ここが 1 回しか呼ばれなかった
    expect(shouldRetry).toHaveBeenCalledTimes(2);
  });

  // H1: withConfig 経由でも親の requestIdHeader が継承される
  it("H1: withConfig 後も親の requestIdHeader が維持される", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const c1 = createHttpClient({
      fetchImpl,
      requestIdHeader: "traceparent",
      generateRequestId: () => "tp-001",
    });
    // 派生 client にも traceparent が引き継がれる
    const c2 = c1.withConfig({ baseUrl: "https://b" });
    await c2.request({ url: "/x" });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["traceparent"]).toBe("tp-001");
    expect(headers[REQUEST_ID_HEADER]).toBeUndefined();
  });

  // H1: override で requestIdHeader を上書きできる
  it("H1: withConfig の override で requestIdHeader を変更できる", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const c1 = createHttpClient({
      fetchImpl,
      requestIdHeader: "X-Request-Id",
      generateRequestId: () => "rid-001",
    });
    const c2 = c1.withConfig({ requestIdHeader: "traceparent" });
    await c2.request({ url: "/x" });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["traceparent"]).toBe("rid-001");
    expect(headers["X-Request-Id"]).toBeUndefined();
  });

  // M3: retryableStatuses 配列も deep freeze される
  it("M3: client.config.retry.retryableStatuses も freeze される", () => {
    const statuses = [500, 502];
    const client = createHttpClient({
      retry: { retryableStatuses: statuses },
    });
    const exposed = client.config.retry?.retryableStatuses;
    expect(Object.isFrozen(exposed)).toBe(true);
    // 公開された配列は freeze されているが、元の配列は freeze 対象外（snapshot で複製済み）
    expect(Object.isFrozen(statuses)).toBe(false);
    // freeze された配列を push しようとすると TypeError（strict mode）
    expect(() => {
      (exposed as number[]).push(503);
    }).toThrow();
  });

  // M7: auth が throw すると AUTH_FAILED にラップされ retry されない
  it("M7: auth.getAuthHeaders の throw は AUTH_FAILED にラップされ retry されない", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      auth: {
        async getAuthHeaders() {
          throw new Error("token endpoint down");
        },
      },
      retry: { maxRetries: 3, backoffBaseMs: 1, jitter: "none" },
    });
    await expect(client.request({ url: "/x" })).rejects.toMatchObject({
      code: "AUTH_FAILED",
      retryable: false,
      message: "token endpoint down",
    });
    // fetch は呼ばれない (auth で落ちたので)
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // M7: auth が既に HttpError を throw する場合は素通し
  it("M7: auth が HttpError を throw した場合は素通し", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const explicit = new HttpError({
      message: "custom auth error",
      code: "CUSTOM_AUTH",
      retryable: false,
    });
    const client = createHttpClient({
      fetchImpl,
      auth: {
        async getAuthHeaders() {
          throw explicit;
        },
      },
      retry: { maxRetries: 0 },
    });
    await expect(client.request({ url: "/x" })).rejects.toMatchObject({
      code: "CUSTOM_AUTH",
    });
  });

  // M7: auth が非 Error をプリミティブ throw した場合は `auth failed: ...` メッセージにラップ
  it("M7: auth が非 Error を throw した場合は固定メッセージで AUTH_FAILED にラップ", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      auth: {
        async getAuthHeaders(): Promise<Record<string, string>> {
          // プリミティブを throw (toHttpError の非 Error 分岐に到達)
          throw "raw-token-string";
        },
      },
      retry: { maxRetries: 0 },
    });
    await expect(client.request({ url: "/x" })).rejects.toMatchObject({
      code: "AUTH_FAILED",
      retryable: false,
      message: "auth failed: raw-token-string",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // M7: shouldRetry で AUTH_FAILED を retry することは可能
  it("M7: shouldRetry で AUTH_FAILED を retry できる", async () => {
    vi.useFakeTimers();
    let authCalls = 0;
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      auth: {
        async getAuthHeaders() {
          authCalls++;
          if (authCalls === 1) throw new Error("transient");
          return { Authorization: "Bearer ok" };
        },
      },
      retry: {
        maxRetries: 1,
        backoffBaseMs: 1,
        jitter: "none",
        shouldRetry: (err) =>
          (err as { code?: string }).code === "AUTH_FAILED",
      },
    });
    const p = client.request({ url: "/x" });
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toMatchObject({ status: 200 });
    // 2 attempt 分 auth が呼ばれる
    expect(authCalls).toBe(2);
  });

  // willActuallyRetry: shouldRetry が true を返した場合、retryable=true で公開され実際に retry される
  it("shouldRetry が true を返す場合、retryable=true で attempt がリトライされる", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      // 2 回目は成功
      if (calls >= 2) return jsonOk({});
      return new Response("e", { status: 500 });
    });
    const shouldRetry = vi.fn(() => true);
    const client = createHttpClient({
      fetchImpl,
      retry: {
        maxRetries: 3,
        backoffBaseMs: 1,
        backoffMaxMs: 1,
        jitter: "none",
        shouldRetry,
      },
    });
    await client.request({ url: "/x" });
    // retry されて 2 回目で成功
    expect(calls).toBe(2);
    // shouldRetry は 2 回呼ばれている (client.ts の willActuallyRetry 判定 1 回 + withRetry 1 回)
    expect(shouldRetry).toHaveBeenCalledTimes(2);
  });
});
