// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import {
  runErrorInterceptors,
  runRequestInterceptors,
  runResponseInterceptors,
} from "./interceptors.js";
// 型を取り込み
import type { HttpRequest, HttpResponse } from "./types.js";

// 空のリクエスト雛形
function req(): HttpRequest {
  return { url: "u", method: "GET", headers: {}, requestId: "r" };
}
// 空のレスポンス雛形
function res(): HttpResponse {
  return {
    status: 200,
    ok: true,
    headers: {},
    body: undefined,
    raw: new Response(null, { status: 200 }),
    request: req(),
  };
}

describe("runRequestInterceptors", () => {
  // 空配列なら素通し
  it("空配列なら req をそのまま返す", async () => {
    const r = req();
    expect(await runRequestInterceptors(r, [])).toBe(r);
  });
  // 順序通り適用
  it("複数 interceptor を順序通り適用", async () => {
    const a = vi.fn((r: HttpRequest) => ({
      ...r,
      headers: { ...r.headers, A: "1" },
    }));
    const b = vi.fn((r: HttpRequest) => ({
      ...r,
      headers: { ...r.headers, B: "2" },
    }));
    const out = await runRequestInterceptors(req(), [a, b]);
    expect(out.headers).toEqual({ A: "1", B: "2" });
    expect(a.mock.invocationCallOrder[0]).toBeLessThan(b.mock.invocationCallOrder[0]!);
  });
});

describe("runResponseInterceptors", () => {
  // 空配列で素通し
  it("空配列なら res をそのまま返す", async () => {
    const r = res();
    expect(await runResponseInterceptors(r, [])).toBe(r);
  });
  // 順次適用
  it("複数 interceptor を順序通り適用", async () => {
    const a = vi.fn((r: HttpResponse) => ({ ...r, status: 201 }));
    const out = await runResponseInterceptors(res(), [a]);
    expect(out.status).toBe(201);
  });
});

describe("runErrorInterceptors", () => {
  // throw する interceptor の伝播
  it("interceptor が throw すればその例外が伝播", async () => {
    const a = vi.fn(() => {
      throw new Error("from-interceptor");
    });
    await expect(
      runErrorInterceptors(new Error("orig"), req(), [a as never]),
    ).rejects.toThrow("from-interceptor");
  });
  // 全 interceptor が throw しない場合は元エラーを throw（安全網）
  it("全 interceptor が throw しなければ元エラーを最終 throw", async () => {
    // 戻り値で済ます違反 interceptor（型は never なので as never でキャスト）
    const a = vi.fn(async (): Promise<never> => undefined as unknown as never);
    const orig = new Error("orig");
    await expect(runErrorInterceptors(orig, req(), [a])).rejects.toBe(orig);
  });
});
