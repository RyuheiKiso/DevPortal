// vitest API を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { withQuotaGuard } from "./quota.js";
// メモリストア
import { createMemoryStore } from "./memory.js";
// 公開型 / エラーガード
import type { KvStore } from "./types.js";
import { isQuotaError } from "./errors.js";

// QuotaExceededError 様式の例外を投げる set を持つ最小 KvStore を作る
function createQuotaThrowingStore(throwCount = Infinity): KvStore<string> & { setCalls: number } {
  // set 呼び出し回数を記録するためのカウンタ付きストア
  let setCalls = 0;
  // メモリ store を内部に持ち、set だけクォータ例外を投げる
  const inner = createMemoryStore<string>();
  const store: KvStore<string> & { setCalls: number } = {
    get setCalls() {
      return setCalls;
    },
    set setCalls(v: number) {
      setCalls = v;
    },
    async get(key: string): Promise<string | undefined> {
      return inner.get(key);
    },
    async set(key: string, value: string): Promise<void> {
      // 呼び出し回数を進める
      setCalls++;
      // 残り throwCount > 0 ならクォータ例外を投げる
      if (setCalls <= throwCount) {
        // DOMException 互換オブジェクトを throw (isQuotaExceededLike が拾える形)
        const err = Object.assign(new Error("Quota exceeded"), {
          name: "QuotaExceededError",
          code: 22,
        });
        throw err;
      }
      // それ以外は通常通り保存
      await inner.set(key, value);
    },
    async remove(key: string): Promise<void> {
      await inner.remove(key);
    },
    has: async (key: string) => inner.has?.(key) ?? false,
    keys: async () => (await inner.keys?.()) ?? [],
    clear: async () => inner.clear?.(),
    subscribe: inner.subscribe?.bind(inner),
  };
  return store;
}

// withQuotaGuard の網羅テスト
describe("withQuotaGuard", () => {
  // 通常 set は素通し
  it("passes through normal set", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withQuotaGuard<string>()(inner);
    await wrapped.set("k", "v");
    await expect(inner.get("k")).resolves.toBe("v");
  });
  // 非 QuotaExceeded エラーは再 throw
  it("rethrows non-quota errors", async () => {
    // 通常エラーを投げる inner
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => {
        throw new TypeError("not a quota error");
      },
      remove: async () => undefined,
    };
    const wrapped = withQuotaGuard<string>()(inner);
    let thrown: unknown;
    try {
      await wrapped.set("k", "v");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TypeError);
  });
  // 既定 (onQuotaExceeded 未指定) は throw 戦略
  it("throws QuotaError by default when quota is exceeded", async () => {
    const inner = createQuotaThrowingStore(Infinity);
    const wrapped = withQuotaGuard<string>()(inner);
    let thrown: unknown;
    try {
      await wrapped.set("k", "v");
    } catch (e) {
      thrown = e;
    }
    expect(isQuotaError(thrown)).toBe(true);
  });
  // "throw" 戦略
  it("respects 'throw' decision", async () => {
    const inner = createQuotaThrowingStore(Infinity);
    const wrapped = withQuotaGuard<string>({ onQuotaExceeded: () => "throw" })(inner);
    let thrown: unknown;
    try {
      await wrapped.set("k", "v");
    } catch (e) {
      thrown = e;
    }
    expect(isQuotaError(thrown)).toBe(true);
  });
  // "drop" 戦略
  it("respects 'drop' decision", async () => {
    const inner = createQuotaThrowingStore(Infinity);
    const onQuotaExceeded = vi.fn(() => "drop" as const);
    const wrapped = withQuotaGuard<string>({ onQuotaExceeded })(inner);
    // 例外にならない
    await expect(wrapped.set("k", "v")).resolves.toBeUndefined();
    // コールバックが呼ばれている
    expect(onQuotaExceeded).toHaveBeenCalled();
  });
  // "retry" 戦略 + cleanup + 成功
  it("retries after cleanup when 'retry' is selected", async () => {
    // 最初の 1 回は throw、2 回目で成功するストア
    const inner = createQuotaThrowingStore(1);
    const cleanup = vi.fn(async () => undefined);
    const wrapped = withQuotaGuard<string>({
      onQuotaExceeded: () => "retry",
      maxRetries: 1,
      cleanup,
    })(inner);
    // 2 回目の set で成功する
    await expect(wrapped.set("k", "v")).resolves.toBeUndefined();
    // cleanup が 1 回呼ばれている
    expect(cleanup).toHaveBeenCalledTimes(1);
    // inner.set は 2 回呼ばれている (初回 throw + retry 成功)
    expect(inner.setCalls).toBe(2);
  });
  // "retry" 戦略 + maxRetries 超過 → throw
  it("throws after exceeding maxRetries", async () => {
    const inner = createQuotaThrowingStore(Infinity);
    const wrapped = withQuotaGuard<string>({
      onQuotaExceeded: () => "retry",
      maxRetries: 2,
    })(inner);
    let thrown: unknown;
    try {
      await wrapped.set("k", "v");
    } catch (e) {
      thrown = e;
    }
    expect(isQuotaError(thrown)).toBe(true);
    // 初回 + 2 回 retry = 3 回 set
    expect(inner.setCalls).toBe(3);
  });
  // "retry" 戦略 + cleanup 未指定 → cleanup 呼ばずに retry
  it("retries without calling cleanup when cleanup is undefined", async () => {
    const inner = createQuotaThrowingStore(1);
    const wrapped = withQuotaGuard<string>({ onQuotaExceeded: () => "retry" })(inner);
    await wrapped.set("k", "v");
    // 2 回目で成功
    expect(inner.setCalls).toBe(2);
  });
  // get / remove は素通し
  it("get and remove are passed through", async () => {
    const inner = createMemoryStore<string>();
    await inner.set("k", "v");
    const wrapped = withQuotaGuard<string>()(inner);
    await expect(wrapped.get("k")).resolves.toBe("v");
    await wrapped.remove("k");
    await expect(inner.get("k")).resolves.toBeUndefined();
  });
  // 任意機能の素通し
  it("propagates optional methods", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withQuotaGuard<string>()(inner);
    // 各機能が提供される
    expect(wrapped.has).toBeDefined();
    expect(wrapped.keys).toBeDefined();
    expect(wrapped.clear).toBeDefined();
    expect(wrapped.subscribe).toBeDefined();
    // 実動作 (任意機能の関数本体実行をテストする)
    await wrapped.set("k", "v");
    await expect(wrapped.has?.("k")).resolves.toBe(true);
    await expect(wrapped.keys?.()).resolves.toEqual(["k"]);
    const listener = vi.fn();
    const unsub = wrapped.subscribe?.(listener);
    await wrapped.set("k2", "v2");
    expect(listener).toHaveBeenCalled();
    unsub?.();
    await wrapped.clear?.();
    await expect(wrapped.keys?.()).resolves.toEqual([]);
  });
  // 任意機能が無い inner では wrapped にも提供されない
  it("does not expose optional methods when inner lacks them", () => {
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const wrapped = withQuotaGuard<string>()(inner);
    expect(wrapped.has).toBeUndefined();
    expect(wrapped.keys).toBeUndefined();
    expect(wrapped.clear).toBeUndefined();
    expect(wrapped.subscribe).toBeUndefined();
  });
});
