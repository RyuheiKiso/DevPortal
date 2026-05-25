// vitest API を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { withObservable } from "./observable.js";
// メモリストア
import { createMemoryStore } from "./memory.js";
// 公開型
import type { KvStore } from "./types.js";

// withObservable の網羅テスト
describe("withObservable", () => {
  // 基本 set / subscribe
  it("notifies subscribers on set with prev and next", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withObservable<string>()(inner);
    const listener = vi.fn();
    wrapped.subscribe(listener);
    await wrapped.set("k", "v1");
    expect(listener).toHaveBeenLastCalledWith("k", "v1", undefined);
    await wrapped.set("k", "v2");
    expect(listener).toHaveBeenLastCalledWith("k", "v2", "v1");
  });
  // remove で通知 (削除前の値が prev)
  it("notifies on remove with prev value", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withObservable<string>()(inner);
    await wrapped.set("k", "v");
    const listener = vi.fn();
    wrapped.subscribe(listener);
    await wrapped.remove("k");
    expect(listener).toHaveBeenCalledWith("k", undefined, "v");
  });
  // 未保存キーへの remove は通知無し (inner.remove は呼ばれる)
  it("does not notify when removing a missing key", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withObservable<string>()(inner);
    const listener = vi.fn();
    wrapped.subscribe(listener);
    await wrapped.remove("nope");
    expect(listener).not.toHaveBeenCalled();
  });
  // unsubscribe で通知停止
  it("stops notifying after unsubscribe", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withObservable<string>()(inner);
    const listener = vi.fn();
    const unsubscribe = wrapped.subscribe(listener);
    unsubscribe();
    await wrapped.set("k", "v");
    expect(listener).not.toHaveBeenCalled();
  });
  // 二重 unsubscribe で例外にならない
  it("is safe to unsubscribe twice", () => {
    const inner = createMemoryStore<string>();
    const wrapped = withObservable<string>()(inner);
    const unsubscribe = wrapped.subscribe(() => {});
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });
  // emit で外部から通知発火
  it("emit dispatches to subscribers", () => {
    const inner = createMemoryStore<string>();
    const wrapped = withObservable<string>()(inner);
    const listener = vi.fn();
    wrapped.subscribe(listener);
    wrapped.emit("k", "v", "v-old");
    expect(listener).toHaveBeenCalledWith("k", "v", "v-old");
  });
  // 複数 listener
  it("supports multiple subscribers", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withObservable<string>()(inner);
    const l1 = vi.fn();
    const l2 = vi.fn();
    wrapped.subscribe(l1);
    wrapped.subscribe(l2);
    await wrapped.set("k", "v");
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });
  // get は inner に委譲
  it("get delegates to inner", async () => {
    const inner = createMemoryStore<string>();
    await inner.set("k", "v");
    const wrapped = withObservable<string>()(inner);
    await expect(wrapped.get("k")).resolves.toBe("v");
  });
  // has / keys 素通し
  it("propagates has and keys when inner provides them", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withObservable<string>()(inner);
    await wrapped.set("k", "v");
    await expect(wrapped.has?.("k")).resolves.toBe(true);
    await expect(wrapped.keys?.()).resolves.toEqual(["k"]);
  });
  // clear が keys 付きで動く: 全削除通知
  it("clear notifies for each entry when keys are enumerable", async () => {
    const inner = createMemoryStore<string>();
    await inner.set("a", "1");
    await inner.set("b", "2");
    const wrapped = withObservable<string>()(inner);
    const listener = vi.fn();
    wrapped.subscribe(listener);
    await wrapped.clear?.();
    expect(listener).toHaveBeenCalledTimes(2);
    const keys = listener.mock.calls.map((args) => args[0]).sort();
    expect(keys).toEqual(["a", "b"]);
  });
  // clear without keys (inner.keys 無し) → 通知無しで委譲のみ
  it("clear delegates without notifying when inner.keys is missing", async () => {
    // keys 無 / clear あり の最小 KvStore
    let cleared = false;
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
      clear: async () => {
        cleared = true;
      },
    };
    const wrapped = withObservable<string>()(inner);
    const listener = vi.fn();
    wrapped.subscribe(listener);
    await wrapped.clear?.();
    expect(cleared).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });
  // 任意機能が無い inner は wrapped にも提供されない
  it("does not expose optional methods when inner lacks them", () => {
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const wrapped = withObservable<string>()(inner);
    expect(wrapped.has).toBeUndefined();
    expect(wrapped.keys).toBeUndefined();
    expect(wrapped.clear).toBeUndefined();
  });
  // crossTab オプションは構築に影響しない (現状は型シグネチャ目的)
  it("accepts crossTab option without affecting behavior", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withObservable<string>({ crossTab: true })(inner);
    const listener = vi.fn();
    wrapped.subscribe(listener);
    await wrapped.set("k", "v");
    expect(listener).toHaveBeenCalled();
  });
});
