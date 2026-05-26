// vitest API
import { describe, expect, it, vi } from "vitest";
// 対象モジュール
import {
  createAsyncStorageKvStore,
  type AsyncStorageLike,
} from "./asyncStorageAdapter.js";

// テスト用の AsyncStorage 風モック
function createMockAsyncStorage(): AsyncStorageLike & { snapshot(): Map<string, string> } {
  // 内部 map
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      // 未保存なら null
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      // 上書き
      map.set(key, value);
    },
    async removeItem(key) {
      // 削除
      map.delete(key);
    },
    snapshot() {
      // 検証用に map を返す
      return map;
    },
  };
}

// 動作検証
describe("createAsyncStorageKvStore", () => {
  // get / set / remove のラウンドトリップ
  it("round-trips values via JSON serialization", async () => {
    // mock
    const storage = createMockAsyncStorage();
    // adapter
    const kv = createAsyncStorageKvStore(storage);
    // set
    await kv.set("k", { a: 1 });
    // get
    expect(await kv.get("k")).toEqual({ a: 1 });
    // remove
    await kv.remove("k");
    // 取得すると undefined
    expect(await kv.get("k")).toBeUndefined();
  });

  // 既定 namespace は空文字なので prefix は付かない (createOutboxStorage 側に namespace を寄せるため)
  it("does not prefix keys by default", async () => {
    const storage = createMockAsyncStorage();
    const kv = createAsyncStorageKvStore(storage);
    await kv.set("k", "v");
    // raw key には prefix が付かない
    expect(storage.snapshot().has("k")).toBe(true);
  });

  // namespace 指定時のみ prefix を適用
  it("applies namespace prefix when explicitly specified", async () => {
    const storage = createMockAsyncStorage();
    const kv = createAsyncStorageKvStore(storage, { namespace: "myns" });
    await kv.set("k", "v");
    // raw key に prefix が付いている
    expect(storage.snapshot().has("myns:k")).toBe(true);
  });

  // カスタム serialize / deserialize
  it("respects custom serialize and deserialize", async () => {
    // base64 を simulate (例として常に固定文字列に直列化)
    const serialize = vi.fn().mockReturnValue("ENC");
    const deserialize = vi.fn().mockReturnValue({ a: "dec" });
    const storage = createMockAsyncStorage();
    const kv = createAsyncStorageKvStore(storage, { serialize, deserialize });
    await kv.set("k", { a: 1 });
    // serialize が呼ばれた
    expect(serialize).toHaveBeenCalledWith({ a: 1 });
    // 取得時に deserialize が呼ばれる
    const result = await kv.get("k");
    expect(deserialize).toHaveBeenCalledWith("ENC");
    expect(result).toEqual({ a: "dec" });
  });

  // get で未保存値は undefined
  it("returns undefined for missing keys", async () => {
    const storage = createMockAsyncStorage();
    const kv = createAsyncStorageKvStore(storage);
    expect(await kv.get("missing")).toBeUndefined();
  });

  // deserialize 失敗時の "skip" モード (既定)
  it('skips deserialize failure by default (logs warn and returns undefined)', async () => {
    // 不正な JSON を直接書き込む
    const storage = createMockAsyncStorage();
    storage.snapshot().set("k", "{not-json}");
    // logger を mock
    const logger = { warn: vi.fn() };
    const kv = createAsyncStorageKvStore(storage, { logger });
    // get は undefined を返す (throw せず)
    expect(await kv.get("k")).toBeUndefined();
    // warn が呼ばれた
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("deserialize failed"),
      expect.objectContaining({ key: "k" }),
    );
  });

  // deserialize 失敗時の "throw" モード
  it('throws deserialize failure when onDeserializeError is "throw"', async () => {
    // 不正な JSON
    const storage = createMockAsyncStorage();
    storage.snapshot().set("k", "{not-json}");
    const kv = createAsyncStorageKvStore(storage, { onDeserializeError: "throw" });
    // throw する
    await expect(kv.get("k")).rejects.toThrow();
  });

  // logger 未指定でも skip モードは動作
  it("skip mode works without logger", async () => {
    const storage = createMockAsyncStorage();
    storage.snapshot().set("k", "{not-json}");
    const kv = createAsyncStorageKvStore(storage);
    // logger なしで呼んでも throw しない
    await expect(kv.get("k")).resolves.toBeUndefined();
  });
});
