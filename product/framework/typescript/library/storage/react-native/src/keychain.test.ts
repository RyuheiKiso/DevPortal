// vitest API を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { createKeychainBackend } from "./keychain.js";
// ローカル型
import type { KeychainModule } from "./types.js";

// react-native-keychain のモックを作るヘルパ (service ごとに 1 エントリ)
function createKeychainMock(): KeychainModule {
  // service → { username, password } のマップ
  const map = new Map<string, { username: string; password: string }>();
  return {
    async setGenericPassword(username, password, options) {
      // service 名 (省略時 "default")
      const service = options?.service ?? "default";
      map.set(service, { username, password });
      return true;
    },
    async getGenericPassword(options) {
      const service = options?.service ?? "default";
      const entry = map.get(service);
      // 未保存は false
      if (entry === undefined) return false;
      return { ...entry, service };
    },
    async resetGenericPassword(options) {
      const service = options?.service ?? "default";
      // 削除 (存在しない場合も true を返す)
      map.delete(service);
      return true;
    },
  };
}

// perKey モードの網羅テスト
describe("createKeychainBackend (perKey mode)", () => {
  // round-trip
  it("round-trips values via separate services", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km);
    await store.set("k", "v");
    await expect(store.get("k")).resolves.toBe("v");
  });
  // 未保存は undefined
  it("returns undefined for missing keys", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km);
    await expect(store.get("nope")).resolves.toBeUndefined();
  });
  // remove
  it("removes a value", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km);
    await store.set("k", "v");
    await store.remove("k");
    await expect(store.get("k")).resolves.toBeUndefined();
  });
  // service prefix を反映
  it("uses servicePrefix in service naming", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km, { servicePrefix: "myapp" });
    await store.set("auth", "secret");
    // myapp/auth で見ると保存されているはず (内部実装に基づく観察)
    const directLookup = await km.getGenericPassword({ service: "myapp/auth" });
    expect(directLookup).not.toBe(false);
  });
});

// singleService モードの網羅テスト
describe("createKeychainBackend (singleService mode)", () => {
  // round-trip
  it("round-trips values via a single JSON bundle", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km, { mode: "singleService" });
    await store.set("a", "1");
    await store.set("b", "2");
    await expect(store.get("a")).resolves.toBe("1");
    await expect(store.get("b")).resolves.toBe("2");
  });
  // 未保存は undefined
  it("returns undefined for missing keys", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km, { mode: "singleService" });
    await expect(store.get("nope")).resolves.toBeUndefined();
  });
  // remove
  it("removes a single key from the bundle", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km, { mode: "singleService" });
    await store.set("a", "1");
    await store.set("b", "2");
    await store.remove("a");
    await expect(store.get("a")).resolves.toBeUndefined();
    await expect(store.get("b")).resolves.toBe("2");
  });
  // has
  it("has reflects presence in bundle", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km, { mode: "singleService" });
    await expect(store.has?.("k")).resolves.toBe(false);
    await store.set("k", "v");
    await expect(store.has?.("k")).resolves.toBe(true);
  });
  // keys 一覧
  it("lists keys in the bundle", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km, { mode: "singleService" });
    await store.set("a", "1");
    await store.set("b", "2");
    const keys = (await store.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["a", "b"]);
  });
  // 全削除
  it("clear removes the entire bundle", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km, { mode: "singleService" });
    await store.set("a", "1");
    await store.set("b", "2");
    await store.clear?.();
    await expect(store.keys?.()).resolves.toEqual([]);
  });
  // 壊れた JSON はクラッシュせず空マップ扱い
  it("recovers from a corrupted bundle as an empty map", async () => {
    const km = createKeychainMock();
    // 不正な JSON を直接埋め込む
    await km.setGenericPassword("bundle", "{not json", { service: "k1s0-storage-bundle" });
    const store = createKeychainBackend(km, { mode: "singleService" });
    // 取得は undefined (壊れていれば空扱い)
    await expect(store.get("a")).resolves.toBeUndefined();
    // 上書きで初期化される
    await store.set("a", "1");
    await expect(store.get("a")).resolves.toBe("1");
  });
  // singleService 名を上書き
  it("respects custom singleService name", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km, {
      mode: "singleService",
      singleService: "my-vault",
    });
    await store.set("k", "v");
    // 指定の service に書かれている
    const directLookup = await km.getGenericPassword({ service: "my-vault" });
    expect(directLookup).not.toBe(false);
  });

  // JSON は valid だが値型違反のレコードは silently 空マップ扱い
  it("値型が string でないレコードは空マップ扱いで silently drop される", async () => {
    const km = createKeychainMock();
    // 値が数値のレコードを仕込む (改ざんシナリオ)
    await km.setGenericPassword(
      "bundle",
      JSON.stringify({ a: 123, b: "ok" }),
      { service: "k1s0-storage-bundle" },
    );
    const store = createKeychainBackend(km, { mode: "singleService" });
    // 検証失敗で空マップ扱いとなり、すべて undefined
    await expect(store.get("a")).resolves.toBeUndefined();
    await expect(store.get("b")).resolves.toBeUndefined();
  });

  // JSON は valid だが配列の場合も空マップ扱い
  it("JSON が配列の場合も空マップ扱いになる", async () => {
    const km = createKeychainMock();
    // 配列を仕込む
    await km.setGenericPassword(
      "bundle",
      JSON.stringify(["x", "y"]),
      { service: "k1s0-storage-bundle" },
    );
    const store = createKeychainBackend(km, { mode: "singleService" });
    // 取得は空マップとして undefined
    await expect(store.get("0")).resolves.toBeUndefined();
  });

  // JSON は valid だが null の場合も空マップ扱い
  it("JSON が null の場合も空マップ扱いになる", async () => {
    const km = createKeychainMock();
    // null を仕込む
    await km.setGenericPassword("bundle", "null", { service: "k1s0-storage-bundle" });
    const store = createKeychainBackend(km, { mode: "singleService" });
    // 取得は空マップとして undefined
    await expect(store.get("k")).resolves.toBeUndefined();
  });
});
