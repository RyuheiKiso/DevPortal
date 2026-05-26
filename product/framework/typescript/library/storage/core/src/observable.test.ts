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
  // 同一キーへの並行 set が直列化され、emit 順と inner 最終値が一致すること
  // (Critical: read-modify-write の非アトミックによる UI 値の食い違いを防ぐ)
  it("並行 set/set がキー単位に直列化され、prev/next の連鎖が壊れない", async () => {
    // 非同期な inner を作るため、各 op に微小遅延を入れたラッパを噛ませる
    const inner = createMemoryStore<string>();
    // inner.get / set / remove に sleep を仕込んだプロキシ (race ウィンドウを広げる)
    const slowInner: KvStore<string> = {
      get: async (k) => {
        // 1 マイクロタスクぶん遅延
        await Promise.resolve();
        return inner.get(k);
      },
      set: async (k, v) => {
        // 2 マイクロタスクぶん遅延 (set 中に並行 op が割り込むウィンドウを作る)
        await Promise.resolve();
        await Promise.resolve();
        return inner.set(k, v);
      },
      remove: async (k) => {
        await Promise.resolve();
        return inner.remove(k);
      },
    };
    const wrapped = withObservable<string>()(slowInner);
    // emit の prev/next を全て記録
    const events: Array<[string, string | undefined, string | undefined]> = [];
    wrapped.subscribe((k, n, p) => events.push([k, n, p]));
    // 同一キーへ 2 つの set を fire-and-forget で並列発火
    const p1 = wrapped.set("k", "A");
    const p2 = wrapped.set("k", "B");
    // 双方の完了を待つ
    await Promise.all([p1, p2]);
    // 最終値が後発の B であること
    await expect(wrapped.get("k")).resolves.toBe("B");
    // emit は 2 件、順番に (undefined→A) → (A→B) の連鎖になっていること
    expect(events).toEqual([
      ["k", "A", undefined],
      ["k", "B", "A"],
    ]);
  });
  // set / remove / set の混在でも直列化が機能すること
  it("並行 set/remove/set が直列化され、最終値と emit 件数が期待通り", async () => {
    const inner = createMemoryStore<string>();
    // 同様に微小遅延の inner ラッパ
    const slowInner: KvStore<string> = {
      get: async (k) => {
        await Promise.resolve();
        return inner.get(k);
      },
      set: async (k, v) => {
        await Promise.resolve();
        return inner.set(k, v);
      },
      remove: async (k) => {
        await Promise.resolve();
        return inner.remove(k);
      },
    };
    const wrapped = withObservable<string>()(slowInner);
    const listener = vi.fn();
    wrapped.subscribe(listener);
    // 同一キーで set('A'), remove(), set('B') を並列発火
    await Promise.all([wrapped.set("k", "A"), wrapped.remove("k"), wrapped.set("k", "B")]);
    // 最終値は最後に await された set('B') の値
    await expect(wrapped.get("k")).resolves.toBe("B");
    // 期待される emit シーケンス:
    //   set('A')   → emit('k', 'A', undefined)
    //   remove()   → prev='A' なので emit('k', undefined, 'A')
    //   set('B')   → prev=undefined なので emit('k', 'B', undefined)
    // 計 3 件
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls).toEqual([
      ["k", "A", undefined],
      ["k", undefined, "A"],
      ["k", "B", undefined],
    ]);
  });
  // clear が「先行発火された set/remove を drain してから」 emit を発火することを検証
  // (clear ゲートの drain 経路 = pending を await する分岐をカバー)
  it("並行 set→clear で set を drain してから clear が全 emit を行う", async () => {
    const inner = createMemoryStore<string>();
    // clear 前に値を入れておく
    await inner.set("a", "1");
    await inner.set("b", "2");
    const wrapped = withObservable<string>()(inner);
    const events: Array<[string, string | undefined, string | undefined]> = [];
    wrapped.subscribe((k, n, p) => events.push([k, n, p]));
    // set を先に発火してから clear。set は chains に乗っているので clear が drain で待つ。
    await Promise.all([wrapped.set("c", "X"), wrapped.clear?.()]);
    // 期待: set('c','X') が drain で先行 → ('c','X',undef)、その後 clear が a/b/c 全てに emit
    expect(events.length).toBe(4);
    // 先頭は set の emit
    expect(events[0]).toEqual(["c", "X", undefined]);
    // 残り 3 件は clear の emit (順序不問、いずれも next=undefined)
    const remainingKeys = events.slice(1).map((e) => e[0]).sort();
    expect(remainingKeys).toEqual(["a", "b", "c"]);
    for (const e of events.slice(1)) {
      // clear の emit は next=undefined
      expect(e[1]).toBeUndefined();
    }
    // 最終的に全キー削除済み
    await expect(wrapped.get("a")).resolves.toBeUndefined();
    await expect(wrapped.get("b")).resolves.toBeUndefined();
    await expect(wrapped.get("c")).resolves.toBeUndefined();
  });
  // 連続する clear がゲートにより順次直列化されること (clear-clear serialization 経路をカバー)
  it("並行 clear/clear はゲートにより順次直列化される", async () => {
    // テスト用に innerClear の起動順を記録するモック inner
    const localMap = new Map<string, string>();
    let counter = 0;
    let firstClearOrder = -1;
    let secondClearOrder = -1;
    let invocation = 0;
    const inner: KvStore<string> = {
      get: async (k) => localMap.get(k),
      set: async (k, v) => {
        localMap.set(k, v);
      },
      remove: async (k) => {
        localMap.delete(k);
      },
      keys: async () => Array.from(localMap.keys()),
      clear: async () => {
        // 何回目の clear かを記録
        invocation += 1;
        const me = invocation;
        if (me === 1) firstClearOrder = ++counter;
        else if (me === 2) secondClearOrder = ++counter;
        // 微小遅延を入れて並列性を表面化する
        await Promise.resolve();
        // 実際の削除
        localMap.clear();
      },
    };
    const wrapped = withObservable<string>()(inner);
    // 並列に 2 つの clear を発火 (2 つ目はゲートを await して順次走るはず)
    await Promise.all([wrapped.clear?.(), wrapped.clear?.()]);
    // 1 つ目が先に走り、2 つ目はその後 (直列化が効いていれば firstClearOrder=1, secondClearOrder=2)
    expect(firstClearOrder).toBe(1);
    expect(secondClearOrder).toBe(2);
  });
  // 前段の set が reject しても後段の set が正常に走ること
  // (runSerially の .then(onFulfilled, onRejected) で前段失敗時の op 実行経路をカバー)
  it("並行 set/set で前段が reject しても後段が正常に走る", async () => {
    const inner = createMemoryStore<string>();
    // 1 回目だけ set を reject させる flaky inner
    let setCalls = 0;
    const flakyInner: KvStore<string> = {
      get: async (k) => inner.get(k),
      set: async (k, v) => {
        setCalls += 1;
        // 微小遅延 (op の中身が走る時間を稼ぎ、後発 op が chains に乗る余地を作る)
        await Promise.resolve();
        if (setCalls === 1) {
          // 1 回目は失敗
          throw new Error("boom");
        }
        // 2 回目以降は成功
        await inner.set(k, v);
      },
      remove: async (k) => inner.remove(k),
    };
    const wrapped = withObservable<string>()(flakyInner);
    const listener = vi.fn();
    wrapped.subscribe(listener);
    // 並列に 2 つの set を発火。1 つ目は失敗、2 つ目は成功するはず
    const results = await Promise.allSettled([wrapped.set("k", "A"), wrapped.set("k", "B")]);
    // 1 つ目は rejected (1 回目の inner.set が boom)
    expect(results[0].status).toBe("rejected");
    // 2 つ目は fulfilled (前段の rejection を吸収して後段の op が走った)
    expect(results[1].status).toBe("fulfilled");
    // 最終値は B
    await expect(wrapped.get("k")).resolves.toBe("B");
    // emit は 2 つ目の set のみ (1 つ目は set 失敗で emit までたどり着かない)
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith("k", "B", undefined);
  });
  // keys 無しの inner でも clear のゲートが動作し、並行 set が clear 完了まで待つこと
  it("keys 無しの inner でも clear ゲートが set/remove を排他する", async () => {
    // keys 無し / clear あり の最小 KvStore (内部状態は localMap で擬似)
    const localMap = new Map<string, string>();
    let clearCalledAt = -1;
    let setCalledAt = -1;
    let counter = 0;
    const inner: KvStore<string> = {
      get: async (k) => localMap.get(k),
      set: async (k, v) => {
        // set が走った瞬間の論理タイムを記録 (clear より後であることを期待)
        setCalledAt = ++counter;
        localMap.set(k, v);
      },
      remove: async (k) => {
        localMap.delete(k);
      },
      clear: async () => {
        // clear が走った瞬間の論理タイムを記録 (微小遅延を入れて並列性を表面化)
        await Promise.resolve();
        clearCalledAt = ++counter;
        localMap.clear();
      },
    };
    const wrapped = withObservable<string>()(inner);
    // 並列に clear / set を発火
    await Promise.all([wrapped.clear?.(), wrapped.set("k", "v")]);
    // clear の方が先に走り、set はその後に走るはず (ゲートが効いていれば clearCalledAt < setCalledAt)
    expect(clearCalledAt).toBeGreaterThan(0);
    expect(setCalledAt).toBeGreaterThan(clearCalledAt);
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
