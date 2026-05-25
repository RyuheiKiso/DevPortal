// vitest API を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { createMmkvBackend } from "./mmkv.js";
// ローカル型
import type { MmkvInstance } from "./types.js";

// MMKV モックを作るヘルパ (contains の有無を指定可)
function createMmkvMock(options?: { withContains?: boolean }): MmkvInstance {
  const map = new Map<string, string>();
  const base: MmkvInstance = {
    getString(k: string): string | undefined {
      return map.get(k);
    },
    set(k: string, v: string): void {
      map.set(k, v);
    },
    delete(k: string): void {
      map.delete(k);
    },
    getAllKeys(): string[] {
      return Array.from(map.keys());
    },
    clearAll(): void {
      map.clear();
    },
  };
  if (options?.withContains === true) {
    base.contains = (k: string): boolean => map.has(k);
  }
  return base;
}

// createMmkvBackend の網羅テスト
describe("createMmkvBackend", () => {
  // round-trip
  it("round-trips values", async () => {
    const mmkv = createMmkvMock();
    const store = createMmkvBackend(mmkv);
    await store.set("k", "v");
    await expect(store.get("k")).resolves.toBe("v");
  });
  // 未保存 get
  it("returns undefined for missing keys", async () => {
    const mmkv = createMmkvMock();
    const store = createMmkvBackend(mmkv);
    await expect(store.get("nope")).resolves.toBeUndefined();
  });
  // remove
  it("removes a value", async () => {
    const mmkv = createMmkvMock();
    const store = createMmkvBackend(mmkv);
    await store.set("k", "v");
    await store.remove("k");
    await expect(store.get("k")).resolves.toBeUndefined();
  });
  // has: contains 関数があれば使う
  it("has uses contains when available", async () => {
    const mmkv = createMmkvMock({ withContains: true });
    const store = createMmkvBackend(mmkv);
    await store.set("k", "v");
    await expect(store.has?.("k")).resolves.toBe(true);
    await expect(store.has?.("nope")).resolves.toBe(false);
  });
  // has: contains 無しなら getString で代替
  it("has falls back to getString when contains is missing", async () => {
    const mmkv = createMmkvMock();
    const store = createMmkvBackend(mmkv);
    await expect(store.has?.("k")).resolves.toBe(false);
    await store.set("k", "v");
    await expect(store.has?.("k")).resolves.toBe(true);
  });
  // keys
  it("lists all keys", async () => {
    const mmkv = createMmkvMock();
    const store = createMmkvBackend(mmkv);
    await store.set("a", "1");
    await store.set("b", "2");
    const keys = (await store.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["a", "b"]);
  });
  // clear
  it("clears all entries", async () => {
    const mmkv = createMmkvMock();
    const store = createMmkvBackend(mmkv);
    await store.set("a", "1");
    await store.clear?.();
    await expect(store.keys?.()).resolves.toEqual([]);
  });
});
