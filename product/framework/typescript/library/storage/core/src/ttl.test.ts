// vitest API を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { withTtl } from "./ttl.js";
import type { TtlEnvelope } from "./ttl.js";
// メモリストアを取り込み
import { createMemoryStore } from "./memory.js";
// 公開型
import type { KvStore } from "./types.js";

// withTtl の網羅テスト
describe("withTtl", () => {
  // 未保存キーの取得
  it("returns undefined for missing keys", async () => {
    // エンベロープ用 memory store
    const inner = createMemoryStore<TtlEnvelope<string>>();
    // wrap
    const wrapped = withTtl<string>()(inner);
    // 未保存は undefined
    await expect(wrapped.get("nope")).resolves.toBeUndefined();
  });
  // 期限内 set + get
  it("round-trips a value within ttl", async () => {
    // 内部に保存される値を制御するため now を固定する
    let current = 1000;
    const inner = createMemoryStore<TtlEnvelope<string>>();
    // wrap
    const wrapped = withTtl<string>({ defaultTtlMs: 100, now: () => current })(inner);
    // set 時の now=1000、期限は 1100
    await wrapped.set("k", "v");
    // 期限内 (now=1050) なら値を返す
    current = 1050;
    await expect(wrapped.get("k")).resolves.toBe("v");
  });
  // 期限切れ判定の境界
  it("treats expired entries as undefined and removes them", async () => {
    // now を制御
    let current = 1000;
    const inner = createMemoryStore<TtlEnvelope<string>>();
    // wrap (TTL 100ms)
    const wrapped = withTtl<string>({ defaultTtlMs: 100, now: () => current })(inner);
    // set 後の期限は 1100
    await wrapped.set("k", "v");
    // 境界 (now === expiresAt) で期限切れ扱い
    current = 1100;
    await expect(wrapped.get("k")).resolves.toBeUndefined();
    // 期限切れ後の inner は遅延削除されている
    await expect(inner.get("k")).resolves.toBeUndefined();
  });
  // now を省略すると Date.now が使われる
  it("uses Date.now when no now is provided", async () => {
    // memory store
    const inner = createMemoryStore<TtlEnvelope<string>>();
    // 過去の期限を持つエントリを直接書く (現在時刻より十分前 = 期限切れ)
    await inner.set("k", { value: "v", expiresAt: 0 });
    // now 未指定で wrap
    const wrapped = withTtl<string>()(inner);
    // 既定の Date.now が使われ、期限切れ判定される
    await expect(wrapped.get("k")).resolves.toBeUndefined();
  });
  // expiresAt 未指定エントリは無期限
  it("treats entries without expiresAt as immortal", async () => {
    // now を制御
    let current = 1000;
    const inner = createMemoryStore<TtlEnvelope<string>>();
    // 直接 inner に expiresAt なしのエンベロープを書く (set 経由ではないので無期限)
    await inner.set("k", { value: "v" });
    // wrap (defaultTtlMs 未指定)
    const wrapped = withTtl<string>({ now: () => current })(inner);
    // 大きく時間が経過してもまだ取れる
    current = 9_999_999;
    await expect(wrapped.get("k")).resolves.toBe("v");
  });
  // defaultTtlMs 未指定の set は無期限エンベロープ
  it("set without defaultTtlMs stores an immortal envelope", async () => {
    // memory store
    const inner = createMemoryStore<TtlEnvelope<string>>();
    // wrap (defaultTtlMs 未指定)
    const wrapped = withTtl<string>()(inner);
    // set
    await wrapped.set("k", "v");
    // inner には expiresAt が無い
    const env = await inner.get("k");
    expect(env).toEqual({ value: "v" });
  });
  // setWithTtl で個別 TTL
  it("setWithTtl stores per-call ttl", async () => {
    // now を制御
    let current = 1000;
    const inner = createMemoryStore<TtlEnvelope<string>>();
    // wrap
    const wrapped = withTtl<string>({ now: () => current })(inner);
    // 50ms の TTL で保存
    await wrapped.setWithTtl("k", "v", 50);
    // 期限内なら取得できる
    current = 1049;
    await expect(wrapped.get("k")).resolves.toBe("v");
    // 期限後は undefined
    current = 1050;
    await expect(wrapped.get("k")).resolves.toBeUndefined();
  });
  // remove は inner に委譲
  it("remove delegates to inner", async () => {
    // memory store
    const inner = createMemoryStore<TtlEnvelope<string>>();
    // wrap
    const wrapped = withTtl<string>()(inner);
    // set + remove
    await wrapped.set("k", "v");
    await wrapped.remove("k");
    // inner からも消えている
    await expect(inner.get("k")).resolves.toBeUndefined();
  });
  // has / keys / clear / subscribe の素通し (inner が提供する場合)
  it("propagates optional methods when inner provides them", async () => {
    // memory store (全機能あり)
    const inner = createMemoryStore<TtlEnvelope<string>>();
    // wrap
    const wrapped = withTtl<string>()(inner);
    // set 後の has は true
    await wrapped.set("k", "v");
    await expect(wrapped.has?.("k")).resolves.toBe(true);
    // keys は ["k"]
    await expect(wrapped.keys?.()).resolves.toEqual(["k"]);
    // clear で空に
    await wrapped.clear?.();
    await expect(wrapped.keys?.()).resolves.toEqual([]);
  });
  // subscribe で実値が通知される
  it("subscribe forwards unwrapped value on set/remove", async () => {
    // memory store
    const inner = createMemoryStore<TtlEnvelope<string>>();
    // wrap
    const wrapped = withTtl<string>()(inner);
    // listener
    const listener = vi.fn();
    wrapped.subscribe?.(listener);
    // set
    await wrapped.set("k", "v1");
    // 通知 (next='v1', prev=undefined)
    expect(listener).toHaveBeenLastCalledWith("k", "v1", undefined);
    // 上書き
    await wrapped.set("k", "v2");
    // 通知 (next='v2', prev='v1')
    expect(listener).toHaveBeenLastCalledWith("k", "v2", "v1");
    // 削除
    await wrapped.remove("k");
    // 通知 (next=undefined, prev='v2')
    expect(listener).toHaveBeenLastCalledWith("k", undefined, "v2");
  });
  // 任意機能が無い inner では wrapped にも提供されない
  it("does not expose optional methods when inner lacks them", () => {
    // 最小 KvStore (任意機能なし)
    const inner: KvStore<TtlEnvelope<string>> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    // wrap
    const wrapped = withTtl<string>()(inner);
    // すべて undefined
    expect(wrapped.has).toBeUndefined();
    expect(wrapped.keys).toBeUndefined();
    expect(wrapped.clear).toBeUndefined();
    expect(wrapped.subscribe).toBeUndefined();
  });
});
