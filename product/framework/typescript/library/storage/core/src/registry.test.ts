// vitest API を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { createStorageRegistry } from "./registry.js";
// メモリストア
import { createMemoryStore } from "./memory.js";
// 公開型 / エラーガード
import type { KvStore } from "./types.js";
import { isStorageNotAvailableError } from "./errors.js";

// 4 スコープ分の memory store を作るヘルパ
function buildAllScopes() {
  return {
    secure: createMemoryStore<unknown>(),
    durable: createMemoryStore<unknown>(),
    session: createMemoryStore<unknown>(),
    ephemeral: createMemoryStore<unknown>(),
  };
}

// createStorageRegistry の網羅テスト
describe("createStorageRegistry", () => {
  // 各スコープを公開している
  it("exposes each scope through properties and get()", () => {
    const scopes = buildAllScopes();
    const reg = createStorageRegistry(scopes);
    // プロパティで参照
    expect(reg.secure).toBe(scopes.secure);
    expect(reg.durable).toBe(scopes.durable);
    expect(reg.session).toBe(scopes.session);
    expect(reg.ephemeral).toBe(scopes.ephemeral);
    // get() でも参照
    expect(reg.get("secure")).toBe(scopes.secure);
    expect(reg.get("durable")).toBe(scopes.durable);
    expect(reg.get("session")).toBe(scopes.session);
    expect(reg.get("ephemeral")).toBe(scopes.ephemeral);
  });
  // clearScope (exceptKeys 無) → 全消去
  it("clearScope without exceptKeys clears the whole scope", async () => {
    const scopes = buildAllScopes();
    await scopes.durable.set("a", 1);
    await scopes.durable.set("b", 2);
    const reg = createStorageRegistry(scopes);
    await reg.clearScope("durable");
    await expect(scopes.durable.keys?.()).resolves.toEqual([]);
  });
  // clearScope (exceptKeys 配列)
  it("clearScope with exceptKeys array preserves listed keys", async () => {
    const scopes = buildAllScopes();
    await scopes.durable.set("a", 1);
    await scopes.durable.set("b", 2);
    await scopes.durable.set("c", 3);
    const reg = createStorageRegistry(scopes);
    await reg.clearScope("durable", { exceptKeys: ["b"] });
    const remaining = (await scopes.durable.keys?.()) ?? [];
    expect(remaining).toEqual(["b"]);
  });
  // clearScope (exceptKeys 関数)
  it("clearScope with exceptKeys predicate preserves matching keys", async () => {
    const scopes = buildAllScopes();
    await scopes.durable.set("pref.a", 1);
    await scopes.durable.set("pref.b", 2);
    await scopes.durable.set("temp.c", 3);
    const reg = createStorageRegistry(scopes);
    // "pref." で始まるキーを残す
    await reg.clearScope("durable", { exceptKeys: (k) => k.startsWith("pref.") });
    const remaining = ((await scopes.durable.keys?.()) ?? []).sort();
    expect(remaining).toEqual(["pref.a", "pref.b"]);
  });
  // clearScope (clear 無 + exceptKeys 無) → StorageNotAvailable
  it("throws StorageNotAvailable when clear is unsupported and no exceptKeys", async () => {
    // clear / keys 無の最小 KvStore
    const noClear: KvStore<unknown> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const reg = createStorageRegistry({
      secure: noClear,
      durable: createMemoryStore<unknown>(),
      session: createMemoryStore<unknown>(),
      ephemeral: createMemoryStore<unknown>(),
    });
    let thrown: unknown;
    try {
      await reg.clearScope("secure");
    } catch (e) {
      thrown = e;
    }
    expect(isStorageNotAvailableError(thrown)).toBe(true);
  });
  // clearScope (keys 無 + exceptKeys 指定) → StorageNotAvailable
  it("throws StorageNotAvailable when keys is unsupported and exceptKeys is given", async () => {
    // clear はあるが keys が無い KvStore
    const noKeys: KvStore<unknown> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
      clear: async () => undefined,
    };
    const reg = createStorageRegistry({
      secure: noKeys,
      durable: createMemoryStore<unknown>(),
      session: createMemoryStore<unknown>(),
      ephemeral: createMemoryStore<unknown>(),
    });
    let thrown: unknown;
    try {
      await reg.clearScope("secure", { exceptKeys: ["x"] });
    } catch (e) {
      thrown = e;
    }
    expect(isStorageNotAvailableError(thrown)).toBe(true);
  });
  // clearAll (exceptKeys 無)
  it("clearAll clears every scope", async () => {
    const scopes = buildAllScopes();
    await scopes.secure.set("a", 1);
    await scopes.durable.set("b", 2);
    await scopes.session.set("c", 3);
    await scopes.ephemeral.set("d", 4);
    const reg = createStorageRegistry(scopes);
    await reg.clearAll();
    await expect(scopes.secure.keys?.()).resolves.toEqual([]);
    await expect(scopes.durable.keys?.()).resolves.toEqual([]);
    await expect(scopes.session.keys?.()).resolves.toEqual([]);
    await expect(scopes.ephemeral.keys?.()).resolves.toEqual([]);
  });
  // clearAll (exceptKeys 指定) は各スコープに適用される
  it("clearAll honors exceptKeys for every scope", async () => {
    const scopes = buildAllScopes();
    await scopes.secure.set("keep", 1);
    await scopes.secure.set("drop", 2);
    await scopes.durable.set("keep", 3);
    await scopes.durable.set("drop", 4);
    const reg = createStorageRegistry(scopes);
    await reg.clearAll({ exceptKeys: ["keep"] });
    await expect(scopes.secure.keys?.()).resolves.toEqual(["keep"]);
    await expect(scopes.durable.keys?.()).resolves.toEqual(["keep"]);
  });
});
