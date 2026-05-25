// vitest API を取り込み
import { afterEach, describe, expect, it } from "vitest";
// テスト対象
import { createLocalStorageBackend } from "./localStorage.js";

// 各テスト終了時に localStorage を綺麗にする
afterEach(() => {
  window.localStorage.clear();
});

// createLocalStorageBackend の網羅テスト
describe("createLocalStorageBackend", () => {
  // window.localStorage を既定で使う
  it("uses window.localStorage by default", async () => {
    // 既定でインスタンス化
    const store = createLocalStorageBackend();
    // 保存
    await store.set("k", "v");
    // 実際に window.localStorage に書かれている
    expect(window.localStorage.getItem("k")).toBe("v");
    // 取得
    await expect(store.get("k")).resolves.toBe("v");
  });
  // 注入された Storage を使う
  it("accepts an injected Storage", async () => {
    // 内部 Map ベースの偽 Storage
    const map = new Map<string, string>();
    const injected: Storage = {
      get length(): number {
        return map.size;
      },
      clear(): void {
        map.clear();
      },
      getItem(k: string): string | null {
        const v = map.get(k);
        return v === undefined ? null : v;
      },
      key(i: number): string | null {
        const keys = Array.from(map.keys());
        return i < keys.length ? (keys[i] as string) : null;
      },
      removeItem(k: string): void {
        map.delete(k);
      },
      setItem(k: string, v: string): void {
        map.set(k, v);
      },
    };
    // 注入してインスタンス化
    const store = createLocalStorageBackend({ storage: injected });
    // 保存と取得
    await store.set("k", "v");
    await expect(store.get("k")).resolves.toBe("v");
    // 注入先のマップに書かれている
    expect(map.get("k")).toBe("v");
  });
  // remove 動作
  it("removes a value", async () => {
    // 既定でインスタンス化
    const store = createLocalStorageBackend();
    // 一旦保存して削除
    await store.set("k", "v");
    await store.remove("k");
    // window.localStorage からも消えている
    expect(window.localStorage.getItem("k")).toBeNull();
  });
  // keys / clear 動作
  it("provides keys and clear via Storage interface", async () => {
    // インスタンス化
    const store = createLocalStorageBackend();
    // 複数キー保存
    await store.set("a", "1");
    await store.set("b", "2");
    // keys が全件を返す
    const keys = (await store.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["a", "b"]);
    // clear で空に
    await store.clear?.();
    await expect(store.keys?.()).resolves.toEqual([]);
  });
});
