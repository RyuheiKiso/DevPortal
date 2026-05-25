// vitest API を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { createAsyncStorageBackend } from "./asyncStorage.js";
// ローカル型
import type { NativeKeyValueStorage } from "./types.js";

// AsyncStorage 風モックを作るヘルパ (getAllKeys / clear の有無を指定可)
function createMock(options?: { withGetAllKeys?: boolean; withClear?: boolean }): NativeKeyValueStorage {
  // 内部状態
  const map = new Map<string, string>();
  // 必須メソッド
  const base: NativeKeyValueStorage = {
    async getItem(k: string): Promise<string | null> {
      const v = map.get(k);
      return v === undefined ? null : v;
    },
    async setItem(k: string, v: string): Promise<void> {
      map.set(k, v);
    },
    async removeItem(k: string): Promise<void> {
      map.delete(k);
    },
  };
  // 任意 getAllKeys
  if (options?.withGetAllKeys === true) {
    base.getAllKeys = async (): Promise<string[]> => Array.from(map.keys());
  }
  // 任意 clear
  if (options?.withClear === true) {
    base.clear = async (): Promise<void> => {
      map.clear();
    };
  }
  return base;
}

// createAsyncStorageBackend の網羅テスト
describe("createAsyncStorageBackend", () => {
  // round-trip
  it("round-trips values", async () => {
    const mock = createMock();
    const store = createAsyncStorageBackend(mock);
    await store.set("k", "v");
    await expect(store.get("k")).resolves.toBe("v");
  });
  // null → undefined 正規化
  it("normalizes null to undefined", async () => {
    const mock = createMock();
    const store = createAsyncStorageBackend(mock);
    await expect(store.get("nope")).resolves.toBeUndefined();
  });
  // remove 動作
  it("removes a value", async () => {
    const mock = createMock();
    const store = createAsyncStorageBackend(mock);
    await store.set("k", "v");
    await store.remove("k");
    await expect(store.get("k")).resolves.toBeUndefined();
  });
  // getAllKeys 提供時のみ keys を持つ
  it("provides keys when getAllKeys is available", async () => {
    const mock = createMock({ withGetAllKeys: true });
    const store = createAsyncStorageBackend(mock);
    await store.set("a", "1");
    await store.set("b", "2");
    const keys = (await store.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["a", "b"]);
  });
  // getAllKeys 未提供時は keys を持たない
  it("does not expose keys when getAllKeys is missing", () => {
    const mock = createMock();
    const store = createAsyncStorageBackend(mock);
    expect(store.keys).toBeUndefined();
  });
  // clear 提供時のみ clear を持つ
  it("provides clear when clear is available", async () => {
    const mock = createMock({ withClear: true });
    const store = createAsyncStorageBackend(mock);
    await store.set("k", "v");
    await store.clear?.();
    await expect(store.get("k")).resolves.toBeUndefined();
  });
  // clear 未提供時は clear を持たない
  it("does not expose clear when clear is missing", () => {
    const mock = createMock();
    const store = createAsyncStorageBackend(mock);
    expect(store.clear).toBeUndefined();
  });
  // 同期 getAllKeys / clear も受け付ける (Promise.resolve で正規化)
  it("accepts synchronous getAllKeys and clear", async () => {
    const map = new Map<string, string>();
    const mock: NativeKeyValueStorage = {
      getItem(k: string): string | null {
        return map.get(k) ?? null;
      },
      setItem(k: string, v: string): void {
        map.set(k, v);
      },
      removeItem(k: string): void {
        map.delete(k);
      },
      getAllKeys(): string[] {
        return Array.from(map.keys());
      },
      clear(): void {
        map.clear();
      },
    };
    const store = createAsyncStorageBackend(mock);
    await store.set("k", "v");
    const keys = (await store.keys?.()) ?? [];
    expect(keys).toEqual(["k"]);
    await store.clear?.();
    await expect(store.keys?.()).resolves.toEqual([]);
  });
});
