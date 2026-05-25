// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象を取り込み
import { createNativeTokenStore } from "./storage.js";
// 公開型を取り込み
import type { NativeKeyValueStorage } from "./storage.js";

// 同期 storage 実装のヘルパ（同期 string|null を返す）
function createSyncStorage(): NativeKeyValueStorage & { backing: Map<string, string> } {
  // バッキング Map
  const backing = new Map<string, string>();
  // NativeKeyValueStorage 契約を満たす実装を返す
  return {
    // バッキングを公開（アサーション用）
    backing,
    // 同期 getItem
    getItem(key: string): string | null {
      // Map から取得
      const value = backing.get(key);
      // undefined を null に変換
      return value === undefined ? null : value;
    },
    // 同期 setItem
    setItem(key: string, value: string): void {
      // Map に保存
      backing.set(key, value);
    },
    // 同期 removeItem
    removeItem(key: string): void {
      // Map から削除
      backing.delete(key);
    },
  };
}

// 非同期 storage 実装のヘルパ（Promise を返す）
function createAsyncStorage(): NativeKeyValueStorage & { backing: Map<string, string> } {
  // バッキング Map
  const backing = new Map<string, string>();
  // 非同期版を返す
  return {
    // 公開バッキング
    backing,
    // Promise を返す getItem
    async getItem(key: string): Promise<string | null> {
      // Map から取得
      const value = backing.get(key);
      // undefined を null に変換
      return value === undefined ? null : value;
    },
    // Promise を返す setItem
    async setItem(key: string, value: string): Promise<void> {
      // Map に保存
      backing.set(key, value);
    },
    // Promise を返す removeItem
    async removeItem(key: string): Promise<void> {
      // Map から削除
      backing.delete(key);
    },
  };
}

// createNativeTokenStore のテスト
describe("createNativeTokenStore", () => {
  // 同期 storage に対して get / set / clear ができること
  it("同期 storage に対して JSON シリアライズで保存・取得・削除する", async () => {
    // 同期 storage
    const storage = createSyncStorage();
    // 既定キーで store を作る
    const store = createNativeTokenStore(storage);
    // 未保存時は undefined
    expect(await store.get()).toBeUndefined();
    // 保存する
    await store.set({ accessToken: "a", refreshToken: "r" });
    // バッキングに JSON で書かれていること
    expect(storage.backing.get("k1s0.auth.tokens")).toBe(JSON.stringify({ accessToken: "a", refreshToken: "r" }));
    // 取得できること
    expect(await store.get()).toEqual({ accessToken: "a", refreshToken: "r" });
    // 削除する
    await store.clear();
    // バッキングから消えていること
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // 非同期 storage に対しても同様に動作すること
  it("非同期 storage（Promise を返す）でも動作する", async () => {
    // 非同期 storage
    const storage = createAsyncStorage();
    // カスタムキーで store を作る
    const store = createNativeTokenStore(storage, "custom-key");
    // 未保存時は undefined
    expect(await store.get()).toBeUndefined();
    // 保存する
    await store.set({ accessToken: "z" });
    // カスタムキーで保存されていること
    expect(storage.backing.get("custom-key")).toBe(JSON.stringify({ accessToken: "z" }));
    // 取得できること
    expect(await store.get()).toEqual({ accessToken: "z" });
    // 削除する
    await store.clear();
    // 消えていること
    expect(storage.backing.has("custom-key")).toBe(false);
  });

  // setItem / removeItem が呼ばれていることを spy で確認
  it("set / clear で storage の setItem / removeItem を呼ぶ", async () => {
    // 同期 storage
    const storage = createSyncStorage();
    // setItem を spy
    const setSpy = vi.spyOn(storage, "setItem");
    // removeItem を spy
    const removeSpy = vi.spyOn(storage, "removeItem");
    // store を作る
    const store = createNativeTokenStore(storage);
    // set する
    await store.set({ accessToken: "a" });
    // setItem が呼ばれていること
    expect(setSpy).toHaveBeenCalledTimes(1);
    // clear する
    await store.clear();
    // removeItem が呼ばれていること
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
