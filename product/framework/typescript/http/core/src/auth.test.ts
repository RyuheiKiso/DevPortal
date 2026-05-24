// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { createBearerAuth, createStaticAuth } from "./auth.js";

describe("createBearerAuth", () => {
  // 同期 token
  it("同期 token を Bearer に整形", async () => {
    const a = createBearerAuth(() => "tok-1");
    expect(await a.getAuthHeaders()).toEqual({ Authorization: "Bearer tok-1" });
  });
  // 非同期 token
  it("非同期 token も Bearer に整形", async () => {
    const a = createBearerAuth(async () => "tok-2");
    expect(await a.getAuthHeaders()).toEqual({ Authorization: "Bearer tok-2" });
  });
  // getToken が throw した場合は伝播
  it("getToken の throw は伝播", async () => {
    const a = createBearerAuth(() => {
      throw new Error("no token");
    });
    await expect(a.getAuthHeaders()).rejects.toThrow("no token");
  });
});

describe("createStaticAuth", () => {
  // 渡したヘッダをコピーして返す
  it("ヘッダをコピーして返す", async () => {
    const src = { "X-Token": "abc", Authorization: "Basic xyz" };
    const a = createStaticAuth(src);
    const out = await a.getAuthHeaders();
    expect(out).toEqual(src);
    // 参照ではなくコピーであること
    expect(out).not.toBe(src);
  });
});
