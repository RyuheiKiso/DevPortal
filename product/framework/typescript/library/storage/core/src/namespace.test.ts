// vitest API を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象を取り込み
import { withNamespace } from "./namespace.js";
// メモリストア (subscribe / keys / clear 完備) を取り込み
import { createMemoryStore } from "./memory.js";
// 公開型を取り込み
import type { KvStore } from "./types.js";

// withNamespace のテストブロック
describe("withNamespace", () => {
  // prefix が当たる
  it("applies prefix to keys", async () => {
    // 内部 store
    const inner = createMemoryStore<string>();
    // wrap
    const wrapped = withNamespace<string>("app")(inner);
    // 論理キーで set
    await wrapped.set("k", "v");
    // 物理キーで保存されている (inner.get で確認)
    await expect(inner.get("app:k")).resolves.toBe("v");
    // 論理キー get でも取り出せる
    await expect(wrapped.get("k")).resolves.toBe("v");
  });
  // remove も同様
  it("removes by prefixed key", async () => {
    // 内部 store
    const inner = createMemoryStore<string>();
    // wrap
    const wrapped = withNamespace<string>("app")(inner);
    // 保存 + 削除
    await wrapped.set("k", "v");
    await wrapped.remove("k");
    // 削除されている
    await expect(inner.get("app:k")).resolves.toBeUndefined();
  });
  // has が範囲内で動く
  it("has delegates with prefix", async () => {
    // 内部 store
    const inner = createMemoryStore<string>();
    // wrap
    const wrapped = withNamespace<string>("app")(inner);
    // 保存して has
    await wrapped.set("k", "v");
    await expect(wrapped.has?.("k")).resolves.toBe(true);
    // 別キーは false
    await expect(wrapped.has?.("x")).resolves.toBe(false);
  });
  // keys は prefix 配下のみ + prefix 剥がし
  it("keys strips prefix and excludes other entries", async () => {
    // inner に直接 prefix 外も書いておく
    const inner = createMemoryStore<string>();
    await inner.set("app:a", "1");
    await inner.set("app:b", "2");
    await inner.set("other:c", "3");
    // wrap
    const wrapped = withNamespace<string>("app")(inner);
    // keys は app 配下の論理キーのみ
    const keys = (await wrapped.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["a", "b"]);
  });
  // clear は prefix 配下のみ削除
  it("clear removes only entries within the namespace", async () => {
    // 混在エントリを inner に直接書く
    const inner = createMemoryStore<string>();
    await inner.set("app:a", "1");
    await inner.set("other:c", "3");
    // wrap
    const wrapped = withNamespace<string>("app")(inner);
    // clear で app 配下のみ削除される
    await wrapped.clear?.();
    // app:a は消える
    await expect(inner.get("app:a")).resolves.toBeUndefined();
    // other:c は残る
    await expect(inner.get("other:c")).resolves.toBe("3");
  });
  // empty prefix は素通し
  it("empty prefix passes through transparently", async () => {
    // 内部 store
    const inner = createMemoryStore<string>();
    // 空 prefix
    const wrapped = withNamespace<string>("")(inner);
    // set/get は素通し
    await wrapped.set("k", "v");
    await expect(inner.get("k")).resolves.toBe("v");
    // keys も全件返す
    await expect(wrapped.keys?.()).resolves.toEqual(["k"]);
  });
  // subscribe は範囲内のキーのみ伝搬
  it("subscribe filters to namespace and strips prefix", async () => {
    // 内部 store
    const inner = createMemoryStore<string>();
    // wrap
    const wrapped = withNamespace<string>("app")(inner);
    // listener
    const listener = vi.fn();
    wrapped.subscribe?.(listener);
    // 範囲外を inner に直接書く (通知は来ないはず)
    await inner.set("other:c", "3");
    // 範囲内を wrapped 経由で書く
    await wrapped.set("k", "v");
    // 通知は 1 回のみ、論理キーで届く
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("k", "v", undefined);
  });
  // inner に has が無い場合は wrapped にも無い
  it("does not expose has when inner does not provide it", () => {
    // 最小 KvStore
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    // wrap
    const wrapped = withNamespace<string>("app")(inner);
    // 任意機能は伝播しない
    expect(wrapped.has).toBeUndefined();
    expect(wrapped.keys).toBeUndefined();
    expect(wrapped.clear).toBeUndefined();
    expect(wrapped.subscribe).toBeUndefined();
  });
});
