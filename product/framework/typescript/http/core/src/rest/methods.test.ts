// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { del, get, patch, post, put } from "./methods.js";
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
});
