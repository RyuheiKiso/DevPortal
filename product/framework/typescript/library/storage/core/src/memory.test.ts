// vitest API を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象を取り込み
import { createMemoryStore } from "./memory.js";

// createMemoryStore の網羅テスト
describe("createMemoryStore", () => {
  // 未保存キーの取得
  it("returns undefined for missing keys", async () => {
    // 空ストアを生成
    const store = createMemoryStore<string>();
    // 未保存キーは undefined
    await expect(store.get("nope")).resolves.toBeUndefined();
  });
  // 初期値を反映するケース
  it("seeds initial entries", async () => {
    // 初期値付きで生成
    const store = createMemoryStore<number>({ a: 1, b: 2 });
    // 各キーが反映されている
    await expect(store.get("a")).resolves.toBe(1);
    await expect(store.get("b")).resolves.toBe(2);
  });
  // set / has / keys / remove の基本動作
  it("supports set, has, keys, and remove", async () => {
    // 空ストアを生成
    const store = createMemoryStore<string>();
    // 値を保存
    await store.set("k", "v");
    // 取得できる
    await expect(store.get("k")).resolves.toBe("v");
    // has は true
    await expect(store.has?.("k")).resolves.toBe(true);
    // keys に含まれる
    await expect(store.keys?.()).resolves.toEqual(["k"]);
    // 削除
    await store.remove("k");
    // 削除後は undefined
    await expect(store.get("k")).resolves.toBeUndefined();
    // has は false
    await expect(store.has?.("k")).resolves.toBe(false);
  });
  // 未保存キーの remove は no-op (subscribe も発火しない)
  it("does not notify when removing a missing key", async () => {
    // ストアと listener を用意
    const store = createMemoryStore<string>();
    const listener = vi.fn();
    // 購読
    store.subscribe?.(listener);
    // 未保存キーを remove
    await store.remove("missing");
    // 通知は来ない
    expect(listener).not.toHaveBeenCalled();
  });
  // set で subscribe が新規/更新の prev/next を運ぶ
  it("notifies subscribers on set with prev and next", async () => {
    // ストアと listener を用意
    const store = createMemoryStore<string>();
    const listener = vi.fn();
    // 購読
    store.subscribe?.(listener);
    // 新規 set
    await store.set("k", "v1");
    // 初回は prev=undefined, next="v1"
    expect(listener).toHaveBeenLastCalledWith("k", "v1", undefined);
    // 上書き set
    await store.set("k", "v2");
    // 2 回目は prev="v1", next="v2"
    expect(listener).toHaveBeenLastCalledWith("k", "v2", "v1");
  });
  // remove で subscribe が next=undefined を運ぶ
  it("notifies subscribers on remove with next = undefined", async () => {
    // 初期値ありストア
    const store = createMemoryStore<string>({ k: "init" });
    // listener を購読
    const listener = vi.fn();
    store.subscribe?.(listener);
    // remove で通知
    await store.remove("k");
    // 削除なので next=undefined, prev="init"
    expect(listener).toHaveBeenCalledWith("k", undefined, "init");
  });
  // unsubscribe で停止する
  it("stops notifying after unsubscribe", async () => {
    // ストアと listener
    const store = createMemoryStore<string>();
    const listener = vi.fn();
    // 購読して解除関数を取得
    const unsubscribe = store.subscribe?.(listener);
    // 1 回 set で通知される
    await store.set("k", "v");
    // 解除
    unsubscribe?.();
    // 再度 set でも通知が増えない
    await store.set("k", "v2");
    // 呼び出しは初回の 1 回のみ
    expect(listener).toHaveBeenCalledTimes(1);
  });
  // 同じ listener を 2 回解除しても no-op
  it("is safe to unsubscribe twice", async () => {
    // ストアと listener
    const store = createMemoryStore<string>();
    const listener = vi.fn();
    // 購読
    const unsubscribe = store.subscribe?.(listener);
    // 2 回解除しても例外にならない
    unsubscribe?.();
    expect(() => unsubscribe?.()).not.toThrow();
    // set しても通知されない
    await store.set("k", "v");
    expect(listener).not.toHaveBeenCalled();
  });
  // 複数 listener
  it("supports multiple subscribers", async () => {
    // 2 個の listener を購読
    const store = createMemoryStore<string>();
    const l1 = vi.fn();
    const l2 = vi.fn();
    store.subscribe?.(l1);
    store.subscribe?.(l2);
    // set すると両方に通知
    await store.set("k", "v");
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });
  // clear で全 listener に削除通知が発火する
  it("notifies subscribers for every entry on clear", async () => {
    // 初期値ありストア
    const store = createMemoryStore<string>({ a: "1", b: "2" });
    // listener
    const listener = vi.fn();
    store.subscribe?.(listener);
    // clear 実行
    await store.clear?.();
    // 2 件のエントリ分の通知
    expect(listener).toHaveBeenCalledTimes(2);
    // どのキーが通知されたか確認 (順序は保証されないので mock.calls から検査)
    const keys = listener.mock.calls.map((args) => args[0]).sort();
    expect(keys).toEqual(["a", "b"]);
    // どの通知も next=undefined
    for (const args of listener.mock.calls) {
      // 第 2 引数 (next) は undefined
      expect(args[1]).toBeUndefined();
    }
  });
  // clear 後は keys が空
  it("clears all entries", async () => {
    // 初期値ありストア
    const store = createMemoryStore<string>({ a: "1", b: "2" });
    // clear
    await store.clear?.();
    // keys は空配列
    await expect(store.keys?.()).resolves.toEqual([]);
  });
});
