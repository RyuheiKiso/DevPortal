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

  // H3: 初期化後に元オブジェクトを mutate しても getAuthHeaders の結果が変わらない
  it("H3: 初期化後に元オブジェクトを mutate しても結果に反映されない", async () => {
    const src: Record<string, string> = { "X-Token": "abc" };
    const a = createStaticAuth(src);
    // 初期化後に外部から mutate しても snapshot 側は不変
    src["X-Token"] = "MUTATED";
    src["X-New"] = "leak";
    const out = await a.getAuthHeaders();
    expect(out).toEqual({ "X-Token": "abc" });
    expect(out["X-New"]).toBeUndefined();
  });

  // H3: getAuthHeaders の戻り値を mutate しても次回呼出時の結果に影響しない
  it("H3: 戻り値の mutate は次回呼出時に伝播しない", async () => {
    const a = createStaticAuth({ "X-Token": "abc" });
    const first = await a.getAuthHeaders();
    // 戻り値を破壊
    first["X-Token"] = "BROKEN";
    delete first["X-Token"];
    // 次回呼出時は元の値が返る
    const second = await a.getAuthHeaders();
    expect(second).toEqual({ "X-Token": "abc" });
  });
});
