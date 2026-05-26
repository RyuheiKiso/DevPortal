// vitest API
import { describe, expect, it, vi } from "vitest";
// 対象クラス
import { OutboxEventEmitter } from "./events.js";

// OutboxEventEmitter の挙動を検証
describe("OutboxEventEmitter", () => {
  // subscribe / emit の基本
  it("delivers events to registered listeners", () => {
    // emitter とリスナを用意
    const emitter = new OutboxEventEmitter();
    const listener = vi.fn();
    // 購読
    emitter.subscribe(listener);
    // emit
    emitter.emit({ type: "scheduled" });
    // listener が 1 回呼ばれる
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "scheduled" });
  });

  // unsubscribe 後はイベントが来ない
  it("unsubscribes via the returned function", () => {
    // emitter と listener
    const emitter = new OutboxEventEmitter();
    const listener = vi.fn();
    // 購読して解除関数を受け取る
    const unsubscribe = emitter.subscribe(listener);
    // 解除
    unsubscribe();
    // emit しても呼ばれない
    emitter.emit({ type: "scheduled" });
    expect(listener).not.toHaveBeenCalled();
  });

  // 解除関数を 2 回呼んでも安全 (冪等性)
  it("unsubscribe is idempotent", () => {
    // emitter
    const emitter = new OutboxEventEmitter();
    // 解除関数
    const unsubscribe = emitter.subscribe(() => {});
    // 2 回呼んでも throw しない
    expect(() => {
      unsubscribe();
      unsubscribe();
    }).not.toThrow();
  });

  // 同じ listener は 2 度登録されない (Set の性質)
  it("does not register the same listener twice", () => {
    // emitter
    const emitter = new OutboxEventEmitter();
    const listener = vi.fn();
    // 同一参照を 2 回 subscribe
    emitter.subscribe(listener);
    emitter.subscribe(listener);
    // emit すると 1 回だけ呼ばれる
    emitter.emit({ type: "scheduled" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // listener が throw しても他の listener は呼ばれる
  it("isolates listener exceptions", () => {
    // emitter
    const emitter = new OutboxEventEmitter();
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const safe = vi.fn();
    // 順に登録
    emitter.subscribe(throwing);
    emitter.subscribe(safe);
    // emit (throwing が落ちても safe は呼ばれる)
    expect(() => emitter.emit({ type: "scheduled" })).not.toThrow();
    expect(throwing).toHaveBeenCalled();
    expect(safe).toHaveBeenCalled();
  });

  // clear はすべての listener を削除
  it("clear removes all listeners", () => {
    // emitter
    const emitter = new OutboxEventEmitter();
    const listener = vi.fn();
    emitter.subscribe(listener);
    // クリア
    emitter.clear();
    // emit しても呼ばれない
    emitter.emit({ type: "scheduled" });
    expect(listener).not.toHaveBeenCalled();
    // size も 0
    expect(emitter.size()).toBe(0);
  });

  // size は登録数を返す
  it("size returns current listener count", () => {
    // emitter
    const emitter = new OutboxEventEmitter();
    // 初期は 0
    expect(emitter.size()).toBe(0);
    // 1 個追加
    emitter.subscribe(() => {});
    expect(emitter.size()).toBe(1);
  });
});
