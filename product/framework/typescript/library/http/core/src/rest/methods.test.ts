// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import {
  del,
  get,
  getArrayBuffer,
  getBlob,
  getJson,
  getText,
  patch,
  post,
  put,
} from "./methods.js";
// クライアント生成
import { createHttpClient } from "../client.js";

// JSON 200 を返す Response を生成
function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
// 非 JSON 200 を返す Response を生成
function textOk(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
// 空の 204 No Content
function noContent(): Response {
  return new Response(null, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("rest methods", () => {
  // GET
  it("get は JSON parse 済み body を返す", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({ id: "u1" }));
    const client = createHttpClient({ fetchImpl });
    const res = await get<{ id: string }>(client, "/users/u1");
    expect(res.body).toEqual({ id: "u1" });
  });
  // GET with query
  it("get の query が URL に反映", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ baseUrl: "https://a", fetchImpl });
    await get(client, "/users", { query: { active: true } });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://a/users?active=true");
  });
  // POST: JSON 自動化
  it("post で plain object body は JSON 化 + Content-Type 自動付与", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({ id: "u1" }));
    const client = createHttpClient({ fetchImpl });
    await post(client, "/users", { name: "alice" });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.body).toBe(JSON.stringify({ name: "alice" }));
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
  // POST: Content-Type が既にあるなら尊重
  it("post で既存 Content-Type を尊重", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ fetchImpl });
    await post(client, "/x", { a: 1 }, { headers: { "Content-Type": "application/vnd.x+json" } });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/vnd.x+json");
  });
  // POST: FormData は素通し
  it("post で FormData は素通し（Content-Type 自動付与しない）", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ fetchImpl });
    const fd = new FormData();
    fd.append("a", "1");
    await post(client, "/x", fd);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.body).toBe(fd);
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });
  // PUT
  it("put も同様に body を JSON 化", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ fetchImpl });
    await put(client, "/users/u1", { name: "bob" });
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("PUT");
  });
  // PATCH
  it("patch も同様に body を JSON 化", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ fetchImpl });
    await patch(client, "/users/u1", { name: "carol" });
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("PATCH");
  });
  // DELETE
  it("del は method:DELETE", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ fetchImpl });
    await del(client, "/users/u1");
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("DELETE");
  });
  // 非 JSON レスポンスは body 未パース
  it("非 JSON レスポンスは raw.body を返す（未パース）", async () => {
    const fetchImpl = vi.fn(async () => textOk("hello"));
    const client = createHttpClient({ fetchImpl });
    const res = await get(client, "/x");
    // raw.body は ReadableStream | null
    expect(res.body).toBe(res.raw.body);
  });
  // 空 JSON ボディは undefined
  it("空ボディの JSON レスポンスは body が undefined", async () => {
    const fetchImpl = vi.fn(async () => noContent());
    const client = createHttpClient({ fetchImpl });
    const res = await get(client, "/x");
    expect(res.body).toBeUndefined();
  });
  // body 未指定の POST
  it("post の body 未指定でも動く", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({ fetchImpl });
    await post(client, "/x");
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  // M5: client.defaultHeaders に Content-Type があれば post 側で自動付与しない
  it("M5: defaultHeaders に Content-Type があれば post で application/json を上書きしない", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      defaultHeaders: { "Content-Type": "text/plain" },
    });
    await post(client, "/x", { a: 1 });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    // defaultHeaders 由来の text/plain がそのまま採用される (application/json で上書きされない)
    expect(headers["Content-Type"]).toBe("text/plain");
  });

  // M5: defaultHeaders に Content-Type があっても init.headers で明示すれば優先される
  it("M5: init.headers で Content-Type 指定があれば defaultHeaders より優先", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      defaultHeaders: { "Content-Type": "text/plain" },
    });
    // init.headers の Content-Type が最優先
    await post(client, "/x", { a: 1 }, { headers: { "Content-Type": "application/vnd.x+json" } });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/vnd.x+json");
  });

  // M5: put / patch でも同じ挙動
  it("M5: put でも defaultHeaders の Content-Type は尊重される", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      defaultHeaders: { "content-type": "text/plain" },
    });
    await put(client, "/x", { a: 1 });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    // 小文字キーで指定しても大小無視で検出される
    expect(headers["content-type"]).toBe("text/plain");
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("M5: patch でも defaultHeaders の Content-Type は尊重される", async () => {
    const fetchImpl = vi.fn(async () => jsonOk({}));
    const client = createHttpClient({
      fetchImpl,
      defaultHeaders: { "Content-Type": "text/plain" },
    });
    await patch(client, "/x", { a: 1 });
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("text/plain");
  });
});

describe("rest stream helpers (B-10)", () => {
  // getText
  it("getText は raw.text() で本文を取得", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("hello world", { status: 200, headers: { "Content-Type": "text/plain" } }),
    );
    const client = createHttpClient({ fetchImpl });
    const res = await getText(client, "/x");
    expect(res.body).toBe("hello world");
  });
  // getBlob
  it("getBlob は raw.blob() を返す", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Blob(["data"], { type: "application/octet-stream" }), {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
    );
    const client = createHttpClient({ fetchImpl });
    const res = await getBlob(client, "/x");
    expect(res.body).toBeInstanceOf(Blob);
    expect(res.body.size).toBe(4);
  });
  // getArrayBuffer
  it("getArrayBuffer は raw.arrayBuffer() を返す", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 }),
    );
    const client = createHttpClient({ fetchImpl });
    const res = await getArrayBuffer(client, "/x");
    expect(res.body).toBeInstanceOf(ArrayBuffer);
    expect(res.body.byteLength).toBe(4);
  });
  // getJson: Content-Type を見ず JSON parse を強制
  it("getJson は Content-Type に関わらず JSON parse", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ x: 1 }), {
          status: 200,
          // text/plain でも parse する
          headers: { "Content-Type": "text/plain" },
        }),
    );
    const client = createHttpClient({ fetchImpl });
    const res = await getJson<{ x: number }>(client, "/x");
    expect(res.body).toEqual({ x: 1 });
  });
  // getJson の空ボディ
  it("getJson の空ボディは undefined", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const client = createHttpClient({ fetchImpl });
    const res = await getJson(client, "/x");
    expect(res.body).toBeUndefined();
  });
});
