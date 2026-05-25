// vitest API を取り込み
import { describe, expect, it } from "vitest";
// テスト対象を取り込み
import { createSyncBacked } from "./fromSync.js";
// 公開型を取り込み
import type { SyncStorage } from "./types.js";

// 同期 SyncStorage のスタブを作るヘルパ (length / key を提供)
function createSyncStub(): SyncStorage {
  // 内部 Map で保持
  const m = new Map<string, string>();
  // SyncStorage 契約を組み立てる
  return {
    // getItem は未保存で null
    getItem(k: string): string | null {
      // Map から取得して null 正規化
      const v = m.get(k);
      return v === undefined ? null : v;
    },
    // setItem
    setItem(k: string, v: string): void {
      // そのまま格納
      m.set(k, v);
    },
    // removeItem
    removeItem(k: string): void {
      // Map から削除
      m.delete(k);
    },
    // length アクセス
    get length(): number {
      // 件数を返す
      return m.size;
    },
    // インデックス指定でキー取得
    key(index: number): string | null {
      // キー一覧から index 番目を返す (範囲外は null)
      const keys = Array.from(m.keys());
      return index < keys.length ? (keys[index] as string) : null;
    },
  };
}

// 非同期 SyncStorage のスタブ (length / key 無)
function createAsyncStub(): SyncStorage {
  // 内部 Map
  const m = new Map<string, string>();
  // SyncStorage 契約 (非同期メソッド版)
  return {
    // async getItem
    async getItem(k: string): Promise<string | null> {
      // 未保存は null
      const v = m.get(k);
      return v === undefined ? null : v;
    },
    // async setItem
    async setItem(k: string, v: string): Promise<void> {
      // Map に保存
      m.set(k, v);
    },
    // async removeItem
    async removeItem(k: string): Promise<void> {
      // Map から削除
      m.delete(k);
    },
  };
}

// 同期 SyncStorage 経由のテスト
describe("createSyncBacked with sync storage", () => {
  // round-trip
  it("round-trips values through sync storage", async () => {
    // sync スタブで生成
    const store = createSyncBacked(createSyncStub());
    // 保存
    await store.set("k", "v");
    // 取得
    await expect(store.get("k")).resolves.toBe("v");
  });
  // null → undefined 正規化
  it("normalizes null to undefined on get", async () => {
    // 空ストアで生成
    const store = createSyncBacked(createSyncStub());
    // 未保存キー
    await expect(store.get("nope")).resolves.toBeUndefined();
  });
  // remove 動作
  it("removes a value", async () => {
    // sync スタブで生成
    const store = createSyncBacked(createSyncStub());
    // 一旦保存して削除
    await store.set("k", "v");
    await store.remove("k");
    // 削除後は undefined
    await expect(store.get("k")).resolves.toBeUndefined();
  });
  // keys が length/key 経由で動く
  it("provides keys when length and key are available", async () => {
    // sync スタブで生成
    const store = createSyncBacked(createSyncStub());
    // 複数キー保存
    await store.set("a", "1");
    await store.set("b", "2");
    // keys が全件を返す (順序は問わない)
    const keys = await store.keys?.();
    // ソートして比較
    expect([...(keys ?? [])].sort()).toEqual(["a", "b"]);
  });
  // clear が全削除する
  it("clears all entries when keys are enumerable", async () => {
    // sync スタブで生成
    const store = createSyncBacked(createSyncStub());
    // 2 件保存
    await store.set("a", "1");
    await store.set("b", "2");
    // clear 実行
    await store.clear?.();
    // 全削除後 keys は空
    await expect(store.keys?.()).resolves.toEqual([]);
  });
  // key(i) が null を返す位置はスキップされる (keys / clear 両方の経路)
  it("skips null entries returned by key(i) in both keys and clear", async () => {
    // 削除対象を記録する配列 (clear 動作の検証用)
    const removed: string[] = [];
    // length は 2 だが key(0) が null を返すスタブ
    const inner: SyncStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: (k: string) => {
        // 呼ばれたキーを記録
        removed.push(k);
      },
      length: 2,
      key: (i: number) => (i === 0 ? null : "x"),
    };
    // ラップ
    const store = createSyncBacked(inner);
    // keys は null をスキップして "x" のみ
    await expect(store.keys?.()).resolves.toEqual(["x"]);
    // clear も null 位置をスキップする
    await store.clear?.();
    // null 位置は削除対象に含まれず、"x" のみ削除される
    expect(removed).toEqual(["x"]);
  });
  // key が undefined のときの clear と keys は length あっても提供されない
  it("does not provide keys when key function is missing", () => {
    // length のみ提供する不完全な SyncStorage
    const inner: SyncStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      length: 2,
    };
    // ラップ
    const store = createSyncBacked(inner);
    // keys は提供されない
    expect(store.keys).toBeUndefined();
    // clear も提供されない
    expect(store.clear).toBeUndefined();
  });
});

// 非同期 SyncStorage 経由のテスト
describe("createSyncBacked with async storage", () => {
  // round-trip
  it("round-trips values through async storage", async () => {
    // async スタブで生成
    const store = createSyncBacked(createAsyncStub());
    // 保存と取得
    await store.set("k", "v");
    await expect(store.get("k")).resolves.toBe("v");
  });
  // keys が提供されない (length 未実装)
  it("does not expose keys for async storage without length", () => {
    // async スタブで生成
    const store = createSyncBacked(createAsyncStub());
    // keys は提供されない
    expect(store.keys).toBeUndefined();
    // clear も提供されない
    expect(store.clear).toBeUndefined();
  });
});
