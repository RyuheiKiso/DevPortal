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

  // 並列 set 100 件で全キーが失われないこと
  // (RMW を mutex で直列化することで「並行 set でマップ全体が上書きされる」事故を防ぐ)
  it("並列 set 100 件で全キーが保持される (mutex 直列化の検証)", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km, { mode: "singleService" });
    // 100 個の異なるキーに同時に set を発火する
    const keys = Array.from({ length: 100 }, (_, i) => `k${i}`);
    await Promise.all(keys.map((k, i) => store.set(k, `v${i}`)));
    // 全キーの存在を確認 (RMW が直列化されていれば全件残る)
    const stored = (await store.keys?.()) ?? [];
    expect([...stored].sort()).toEqual(keys.slice().sort());
    // 値もそれぞれ正しいこと
    for (let i = 0; i < keys.length; i += 1) {
      const v = await store.get(keys[i]!);
      expect(v).toBe(`v${i}`);
    }
  });

  // 並列 set + remove の混在も直列化される
  it("並列 set と remove の混在で意図通りの最終状態に収束する", async () => {
    const km = createKeychainMock();
    const store = createKeychainBackend(km, { mode: "singleService" });
    // 事前に "k0".."k9" を入れる
    for (let i = 0; i < 10; i += 1) {
      await store.set(`k${i}`, `v${i}`);
    }
    // 並列で remove k0..k4 と set k10..k14 を発火
    const ops: Array<Promise<void>> = [];
    for (let i = 0; i < 5; i += 1) {
      ops.push(store.remove(`k${i}`));
      ops.push(store.set(`k${i + 10}`, `v${i + 10}`));
    }
    await Promise.all(ops);
    // 最終状態: k5..k9 と k10..k14 が残る (= 10 件)
    const stored = (await store.keys?.()) ?? [];
    expect([...stored].sort()).toEqual(
      ["k10", "k11", "k12", "k13", "k14", "k5", "k6", "k7", "k8", "k9"],
    );
  });
});

// mutex の例外時挙動 (前段の reject で後続が止まらないこと)
describe("createKeychainBackend mutex 例外耐性", () => {
  // 1 つの op が reject しても後続の op は実行される (chain の catch 経路網羅)
  it("前段の reject 後も後続 op は正常に実行される", async () => {
    // setGenericPassword の 1 回目だけ throw する keychain mock
    let callCount = 0;
    const km: KeychainModule = {
      async setGenericPassword(_username, _password, _options) {
        callCount += 1;
        if (callCount === 1) throw new Error("first set fails");
        return true;
      },
      async getGenericPassword() {
        return false;
      },
      async resetGenericPassword() {
        return true;
      },
    };
    const store = createKeychainBackend(km);
    // 1 つ目の set は失敗する
    await expect(store.set("a", "1")).rejects.toThrow("first set fails");
    // 2 つ目の set はチェーンが catch されているため進行できる
    await expect(store.set("b", "2")).resolves.toBeUndefined();
  });
});

// perKey モードでも mutex により全 API 呼出が直列化されること
describe("createKeychainBackend (perKey mode) 直列化", () => {
  // perKey モードでも並列 set は mutex で順序保証される
  it("並列 set は mutex により直列化される (call ordering を確認)", async () => {
    // keychain モックの set 呼出履歴を記録するモック
    const callOrder: string[] = [];
    const km: KeychainModule = {
      async setGenericPassword(username, _password, options) {
        // 直前で短い await を挟むことで、mutex 無しなら interleave が観測できる状況を作る
        await Promise.resolve();
        callOrder.push(`set:${options?.service ?? ""}`);
        return true;
      },
      async getGenericPassword(options) {
        callOrder.push(`get:${options?.service ?? ""}`);
        return false;
      },
      async resetGenericPassword(options) {
        callOrder.push(`reset:${options?.service ?? ""}`);
        return true;
      },
    };
    const store = createKeychainBackend(km);
    // 3 つの set を Promise.all で並列発火
    await Promise.all([store.set("a", "1"), store.set("b", "2"), store.set("c", "3")]);
    // mutex により発火順 (a, b, c) で完了している
    expect(callOrder).toEqual([
      "set:k1s0-storage/a",
      "set:k1s0-storage/b",
      "set:k1s0-storage/c",
    ]);
  });
});
