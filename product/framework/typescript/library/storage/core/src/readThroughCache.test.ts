// vitest API を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { withReadThroughCache } from "./readThroughCache.js";
// メモリストア
import { createMemoryStore } from "./memory.js";
// 公開型
import type { KvStore } from "./types.js";

// withReadThroughCache の網羅テスト
describe("withReadThroughCache", () => {
  // get: tier1 hit
  it("returns tier1 value directly", async () => {
    const tier1 = createMemoryStore<string>();
    const tier2 = createMemoryStore<string>();
    await tier1.set("k", "from-1");
    await tier2.set("k", "from-2");
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    // tier1 が先勝
    await expect(cache.get("k")).resolves.toBe("from-1");
  });
  // get: tier1 miss → tier2 hit → tier1 充填
  it("falls back to tier2 and fills tier1", async () => {
    const tier1 = createMemoryStore<string>();
    const tier2 = createMemoryStore<string>();
    await tier2.set("k", "from-2");
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    // tier2 経由で取得
    await expect(cache.get("k")).resolves.toBe("from-2");
    // tier1 に充填されている
    await expect(tier1.get("k")).resolves.toBe("from-2");
  });
  // get: 両方 miss → undefined
  it("returns undefined when both tiers miss", async () => {
    const tier1 = createMemoryStore<string>();
    const tier2 = createMemoryStore<string>();
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    await expect(cache.get("nope")).resolves.toBeUndefined();
  });
  // set: writeThrough (既定)
  it("write-through writes to both tiers and awaits both", async () => {
    const tier1 = createMemoryStore<string>();
    const tier2 = createMemoryStore<string>();
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    await cache.set("k", "v");
    // 両方に即書かれている
    await expect(tier1.get("k")).resolves.toBe("v");
    await expect(tier2.get("k")).resolves.toBe("v");
  });
  // set: writeBehind (tier1 即時、tier2 はバックグラウンド)
  it("write-behind writes tier1 synchronously and fires tier2", async () => {
    const tier1 = createMemoryStore<string>();
    // tier2 を遅延させて挙動を可視化する
    let tier2Resolve!: () => void;
    const tier2Promise = new Promise<void>((r) => {
      tier2Resolve = r;
    });
    const tier2: KvStore<string> = {
      get: async () => undefined,
      set: async () => {
        await tier2Promise;
      },
      remove: async () => undefined,
    };
    const cache = withReadThroughCache<string>({ tier1, tier2, writePolicy: "writeBehind" });
    // set は tier2 完了を待たずに resolve する
    await cache.set("k", "v");
    // tier1 には既に入っている
    await expect(tier1.get("k")).resolves.toBe("v");
    // tier2 の処理を解放しても問題なく完了する
    tier2Resolve();
  });
  // remove: 両方削除
  it("remove deletes from both tiers", async () => {
    const tier1 = createMemoryStore<string>();
    const tier2 = createMemoryStore<string>();
    await tier1.set("k", "v");
    await tier2.set("k", "v");
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    await cache.remove("k");
    await expect(tier1.get("k")).resolves.toBeUndefined();
    await expect(tier2.get("k")).resolves.toBeUndefined();
  });
  // has: tier1 hit → true
  it("has returns true on tier1 hit", async () => {
    const tier1 = createMemoryStore<string>();
    const tier2 = createMemoryStore<string>();
    await tier1.set("k", "v");
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    await expect(cache.has?.("k")).resolves.toBe(true);
  });
  // has: tier1 miss → tier2 hit → true
  it("has falls back to tier2 when tier1 misses", async () => {
    const tier1 = createMemoryStore<string>();
    const tier2 = createMemoryStore<string>();
    await tier2.set("k", "v");
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    await expect(cache.has?.("k")).resolves.toBe(true);
  });
  // has: 両方 miss → false
  it("has returns false when both miss", async () => {
    const tier1 = createMemoryStore<string>();
    const tier2 = createMemoryStore<string>();
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    await expect(cache.has?.("nope")).resolves.toBe(false);
  });
  // has: 一方が未提供 → 提供されない
  it("does not expose has when one tier lacks it", () => {
    const tier1 = createMemoryStore<string>();
    const tier2: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    expect(cache.has).toBeUndefined();
  });
  // keys: tier2.keys を返す
  it("keys returns tier2 keys", async () => {
    const tier1 = createMemoryStore<string>();
    const tier2 = createMemoryStore<string>();
    await tier2.set("a", "1");
    await tier2.set("b", "2");
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    const keys = (await cache.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["a", "b"]);
  });
  // keys: tier2 に keys 無 → 提供されない
  it("does not expose keys when tier2 lacks keys", () => {
    const tier1 = createMemoryStore<string>();
    const tier2: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    expect(cache.keys).toBeUndefined();
  });
  // clear: 両方クリア
  it("clear clears both tiers", async () => {
    const tier1 = createMemoryStore<string>();
    const tier2 = createMemoryStore<string>();
    await tier1.set("a", "1");
    await tier2.set("a", "1");
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    await cache.clear?.();
    await expect(tier1.keys?.()).resolves.toEqual([]);
    await expect(tier2.keys?.()).resolves.toEqual([]);
  });
  // clear: 一方が未提供 → 提供されない
  it("does not expose clear when one tier lacks clear", () => {
    const tier1 = createMemoryStore<string>();
    const tier2: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const cache = withReadThroughCache<string>({ tier1, tier2 });
    expect(cache.clear).toBeUndefined();
  });
});
