// vitest API を取り込み
import { afterEach, describe, expect, it } from "vitest";
// テスト対象
import { createSessionStorageBackend } from "./sessionStorage.js";

// 各テスト終了時に sessionStorage を綺麗にする
afterEach(() => {
  window.sessionStorage.clear();
});

// createSessionStorageBackend の網羅テスト
describe("createSessionStorageBackend", () => {
  // 既定で window.sessionStorage を使う
  it("uses window.sessionStorage by default", async () => {
    const store = createSessionStorageBackend();
    await store.set("k", "v");
    expect(window.sessionStorage.getItem("k")).toBe("v");
    await expect(store.get("k")).resolves.toBe("v");
  });
  // 注入された Storage を使う
  it("accepts an injected Storage", async () => {
    // 簡易 Map ベース Storage
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
    const store = createSessionStorageBackend({ storage: injected });
    await store.set("k", "v");
    expect(map.get("k")).toBe("v");
  });
});
