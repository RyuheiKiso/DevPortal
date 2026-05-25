// vitest API を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { asKvStore, createTypedSlot } from "./typed.js";
// メモリストアを取り込み (subscribe 付き)
import { createMemoryStore } from "./memory.js";
// 公開型を取り込み
import type { KvStore } from "./types.js";

// createTypedSlot のテストブロック
describe("createTypedSlot", () => {
  // 基本動作
  it("get/set/clear delegate to KvStore", async () => {
    // 内部に memory store
    const inner = createMemoryStore<{ v: number }>();
    // スロット生成
    const slot = createTypedSlot(inner, "k");
    // 初期は undefined
    await expect(slot.get()).resolves.toBeUndefined();
    // set
    await slot.set({ v: 1 });
    // get で取得
    await expect(slot.get()).resolves.toEqual({ v: 1 });
    // clear
    await slot.clear();
    // 取得は undefined
    await expect(slot.get()).resolves.toBeUndefined();
  });
  // subscribe が同じキーの変更だけ伝搬する
  it("subscribe forwards changes for the configured key only", async () => {
    // 内部 memory store
    const inner = createMemoryStore<string>();
    // スロット生成
    const slot = createTypedSlot(inner, "target");
    // listener
    const listener = vi.fn();
    // 購読
    slot.subscribe?.(listener);
    // 関係ないキーの変更
    await inner.set("other", "x");
    // 通知は来ない
    expect(listener).not.toHaveBeenCalled();
    // 関連キーの変更
    await inner.set("target", "y");
    // 通知が来る (next のみ渡される)
    expect(listener).toHaveBeenCalledWith("y");
  });
  // 内部 KvStore に subscribe が無いケース
  it("does not expose subscribe when inner store lacks subscribe", () => {
    // subscribe を持たない最小 KvStore
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    // スロット
    const slot = createTypedSlot(inner, "k");
    // subscribe は提供されない
    expect(slot.subscribe).toBeUndefined();
  });
});

// asKvStore のテストブロック
describe("asKvStore", () => {
  // 単一キーの基本動作
  it("delegates to slot for the configured key only", async () => {
    // memory store とスロット
    const inner = createMemoryStore<string>();
    const slot = createTypedSlot(inner, "key");
    // KvStore 化
    const store = asKvStore(slot, "key");
    // 一致キーの set/get
    await store.set("key", "v");
    await expect(store.get("key")).resolves.toBe("v");
    // 不一致キーの set は no-op
    await store.set("other", "ignored");
    await expect(store.get("other")).resolves.toBeUndefined();
    // 不一致キーの remove も no-op (例外にならない)
    await expect(store.remove("other")).resolves.toBeUndefined();
  });
  // has が undefined 判定で動く
  it("has reflects slot.get value", async () => {
    // memory + slot + as
    const inner = createMemoryStore<string>();
    const slot = createTypedSlot(inner, "k");
    const store = asKvStore(slot, "k");
    // 未保存キーは false
    await expect(store.has?.("k")).resolves.toBe(false);
    // 不一致キーも false
    await expect(store.has?.("x")).resolves.toBe(false);
    // 保存後は true
    await slot.set("v");
    await expect(store.has?.("k")).resolves.toBe(true);
  });
  // keys は常に 1 要素
  it("keys returns the single slot key", async () => {
    // memory + slot + as
    const inner = createMemoryStore<string>();
    const slot = createTypedSlot(inner, "k");
    const store = asKvStore(slot, "k");
    // keys は固定で ["k"]
    await expect(store.keys?.()).resolves.toEqual(["k"]);
  });
  // clear は slot.clear へ委譲
  it("clear delegates to slot.clear", async () => {
    // memory + slot + as
    const inner = createMemoryStore<string>();
    const slot = createTypedSlot(inner, "k");
    const store = asKvStore(slot, "k");
    // 保存して clear
    await slot.set("v");
    await store.clear?.();
    // 取得は undefined
    await expect(slot.get()).resolves.toBeUndefined();
  });
  // remove (一致キー) は slot.clear へ委譲
  it("remove (matching key) delegates to slot.clear", async () => {
    // memory + slot + as
    const inner = createMemoryStore<string>();
    const slot = createTypedSlot(inner, "k");
    const store = asKvStore(slot, "k");
    // 保存して remove
    await slot.set("v");
    await store.remove("k");
    // get は undefined
    await expect(slot.get()).resolves.toBeUndefined();
  });
  // subscribe (slot 経由) が KvStore.subscribe に変換される
  it("subscribe propagates slot changes via KvStore signature", async () => {
    // memory + slot + as
    const inner = createMemoryStore<string>();
    const slot = createTypedSlot(inner, "k");
    const store = asKvStore(slot, "k");
    // listener
    const listener = vi.fn();
    // 購読
    store.subscribe?.(listener);
    // slot.set で通知
    await slot.set("v");
    // key="k", next="v", prev=undefined (asKvStore の prev は常に undefined)
    expect(listener).toHaveBeenCalledWith("k", "v", undefined);
  });
  // slot.subscribe 不在時は KvStore.subscribe も無い
  it("does not expose subscribe when slot lacks subscribe", () => {
    // subscribe 不在の最小 slot
    const slot = {
      get: async () => undefined,
      set: async () => undefined,
      clear: async () => undefined,
    };
    // KvStore 化
    const store = asKvStore(slot, "k");
    // subscribe は無い
    expect(store.subscribe).toBeUndefined();
  });
});
