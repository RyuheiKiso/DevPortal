// vitest API を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { createExpoSecureStoreBackend } from "./expoSecureStore.js";
// ローカル型
import type { SecureNativeStorage } from "./types.js";

// SecureNativeStorage モックを作るヘルパ
function createMock(): SecureNativeStorage {
  const map = new Map<string, string>();
  return {
    async getItemAsync(k: string): Promise<string | null> {
      const v = map.get(k);
      return v === undefined ? null : v;
    },
    async setItemAsync(k: string, v: string): Promise<void> {
      map.set(k, v);
    },
    async deleteItemAsync(k: string): Promise<void> {
      map.delete(k);
    },
  };
}

// createExpoSecureStoreBackend の網羅テスト
describe("createExpoSecureStoreBackend", () => {
  // round-trip
  it("round-trips values", async () => {
    const mock = createMock();
    const store = createExpoSecureStoreBackend(mock);
    await store.set("k", "secret");
    await expect(store.get("k")).resolves.toBe("secret");
  });
  // null → undefined 正規化
  it("normalizes null to undefined", async () => {
    const mock = createMock();
    const store = createExpoSecureStoreBackend(mock);
    await expect(store.get("nope")).resolves.toBeUndefined();
  });
  // remove 動作
  it("removes a value", async () => {
    const mock = createMock();
    const store = createExpoSecureStoreBackend(mock);
    await store.set("k", "secret");
    await store.remove("k");
    await expect(store.get("k")).resolves.toBeUndefined();
  });
  // keys / clear は提供されない
  it("does not expose keys or clear", () => {
    const mock = createMock();
    const store = createExpoSecureStoreBackend(mock);
    expect(store.keys).toBeUndefined();
    expect(store.clear).toBeUndefined();
  });
});
