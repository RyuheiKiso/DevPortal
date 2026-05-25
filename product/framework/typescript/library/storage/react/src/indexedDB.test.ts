// vitest API を取り込み
import { afterEach, describe, expect, it } from "vitest";
// テスト対象
import { createIndexedDbBackend } from "./indexedDB.js";

// DB 名を生成する (各テストで隔離)
let counter = 0;
function nextDbName(): string {
  counter++;
  return `test-db-${counter}`;
}

// 各テスト終了時に念のため確認 (fake-indexeddb は自動 isolation)
afterEach(() => {
  // 何もしない (fake-indexeddb の auto module が test 終了時にリセット)
});

// createIndexedDbBackend の網羅テスト
describe("createIndexedDbBackend", () => {
  // round-trip
  it("round-trips a value", async () => {
    const store = createIndexedDbBackend<string>({ dbName: nextDbName(), storeName: "kv" });
    await store.set("k", "v");
    await expect(store.get("k")).resolves.toBe("v");
  });
  // 未保存 get → undefined
  it("returns undefined for missing keys", async () => {
    const store = createIndexedDbBackend<string>({ dbName: nextDbName(), storeName: "kv" });
    await expect(store.get("nope")).resolves.toBeUndefined();
  });
  // remove 動作
  it("removes a value", async () => {
    const store = createIndexedDbBackend<string>({ dbName: nextDbName(), storeName: "kv" });
    await store.set("k", "v");
    await store.remove("k");
    await expect(store.get("k")).resolves.toBeUndefined();
  });
  // has 動作
  it("has reflects presence", async () => {
    const store = createIndexedDbBackend<string>({ dbName: nextDbName(), storeName: "kv" });
    await expect(store.has?.("k")).resolves.toBe(false);
    await store.set("k", "v");
    await expect(store.has?.("k")).resolves.toBe(true);
  });
  // keys 一覧
  it("lists string keys", async () => {
    const store = createIndexedDbBackend<string>({ dbName: nextDbName(), storeName: "kv" });
    await store.set("a", "1");
    await store.set("b", "2");
    const keys = (await store.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["a", "b"]);
  });
  // clear で全削除
  it("clears all entries", async () => {
    const store = createIndexedDbBackend<string>({ dbName: nextDbName(), storeName: "kv" });
    await store.set("a", "1");
    await store.set("b", "2");
    await store.clear?.();
    await expect(store.keys?.()).resolves.toEqual([]);
  });
  // 2 回目の open は同じ Promise を使う (= dbPromise キャッシュの命中)
  it("reuses the open database promise on subsequent calls", async () => {
    const store = createIndexedDbBackend<string>({ dbName: nextDbName(), storeName: "kv" });
    // 1 回目: open される
    await store.set("k", "v");
    // 2 回目: dbPromise が再利用される (キャッシュヒット経路を通る)
    await store.set("k2", "v2");
    // 両方取得できる
    await expect(store.get("k")).resolves.toBe("v");
    await expect(store.get("k2")).resolves.toBe("v2");
  });
  // version 指定経路
  it("respects custom version", async () => {
    const store = createIndexedDbBackend<string>({
      dbName: nextDbName(),
      storeName: "kv",
      version: 2,
    });
    await store.set("k", "v");
    await expect(store.get("k")).resolves.toBe("v");
  });
  // factory 注入
  it("accepts injected IDBFactory", async () => {
    const store = createIndexedDbBackend<string>({
      dbName: nextDbName(),
      storeName: "kv",
      factory: globalThis.indexedDB,
    });
    await store.set("k", "v");
    await expect(store.get("k")).resolves.toBe("v");
  });
  // open が error で reject されるパス (古いバージョンで開こうとして拒否される)
  it("rejects when open request errors out", async () => {
    const name = nextDbName();
    // 先に v2 を作る (ストア "kv" 込み)
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 2);
      req.addEventListener("upgradeneeded", () => {
        req.result.createObjectStore("kv");
      });
      req.addEventListener("success", () => {
        req.result.close();
        resolve();
      });
      req.addEventListener("error", () => reject(req.error));
    });
    // 同じ DB を v1 で開こうとすると VersionError が出る
    const store = createIndexedDbBackend<string>({ dbName: name, storeName: "kv", version: 1 });
    let thrown: unknown;
    try {
      await store.set("k", "v");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
  });
  // 既存ストアあり (upgradeneeded で contains true 分岐を通る)
  // 手動で v1 を作成してクローズし、その後 v2 でバックエンドを open する
  // → upgradeneeded が再発火するが objectStoreNames.contains("kv") === true なので createObjectStore はスキップ
  it("does not recreate object store on version upgrade when it exists", async () => {
    const name = nextDbName();
    // 1. 手動で v1 を作成 (ストア "kv" を作る)
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.addEventListener("upgradeneeded", () => {
        req.result.createObjectStore("kv");
      });
      req.addEventListener("success", () => {
        // 接続をクローズしてから次の open ができるようにする
        req.result.close();
        resolve();
      });
      req.addEventListener("error", () => reject(req.error));
    });
    // 2. バックエンドを v2 で生成 → upgradeneeded が走るが contains=true で createObjectStore はスキップ
    const store = createIndexedDbBackend<string>({ dbName: name, storeName: "kv", version: 2 });
    await store.set("k", "v");
    // 既存ストアが温存され、保存値が読み取れる
    await expect(store.get("k")).resolves.toBe("v");
  });
});
