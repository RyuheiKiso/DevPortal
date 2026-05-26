// vitest API
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// 対象モジュール
import { createOutboxScheduler } from "./scheduler.js";
// 型
import type { OutboxTimer } from "./types.js";

// 簡易タイマー (テスト制御用)
interface MockTimer extends OutboxTimer {
  // 登録中のタスクを全列挙
  getTasks(): readonly { handle: number; cb: () => void; ms: number }[];
  // 指定ハンドルを発火
  fire(handle: number): void;
  // 全タスクを順に発火
  flushAll(): void;
}

// テスト用 mock timer 実装
function createMockTimer(): MockTimer {
  // タスク一覧
  const tasks: { handle: number; cb: () => void; ms: number; cancelled: boolean }[] = [];
  // ハンドルの連番
  let next = 1;
  return {
    // setTimeout 相当: 登録のみ
    set: (cb, ms) => {
      // 連番でハンドル生成
      const handle = next++;
      tasks.push({ handle, cb, ms, cancelled: false });
      return handle;
    },
    // clearTimeout 相当: cancel フラグ
    clear: (handle) => {
      // ハンドル一致でフラグを立てる
      const task = tasks.find((t) => t.handle === handle);
      if (task !== undefined) {
        task.cancelled = true;
      }
    },
    // タスクの参照を返す
    getTasks: () => tasks.filter((t) => !t.cancelled).map(({ handle, cb, ms }) => ({ handle, cb, ms })),
    // 指定ハンドルを実行
    fire: (handle) => {
      // 一致するタスクを取得
      const task = tasks.find((t) => t.handle === handle);
      if (task !== undefined && !task.cancelled) {
        task.cancelled = true;
        task.cb();
      }
    },
    // 全タスクを実行 (FIFO)
    flushAll: () => {
      for (const task of tasks.slice()) {
        if (!task.cancelled) {
          task.cancelled = true;
          task.cb();
        }
      }
    },
  };
}

// scheduler の挙動を検証
describe("createOutboxScheduler", () => {
  // テストごとの timer
  let timer: MockTimer;

  beforeEach(() => {
    // 新しい mock timer
    timer = createMockTimer();
  });

  afterEach(() => {
    // 残タスクを掃除
    timer.flushAll();
  });

  // 起動前は isRunning=false
  it("starts as not running", () => {
    // 生成 (start を呼ばない)
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick: async () => {},
    });
    // 初期値
    expect(scheduler.isRunning()).toBe(false);
  });

  // start でタイマーが登録される
  it("schedules the next tick on start", () => {
    // 生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      random: () => 0.5,
      onTick: async () => {},
    });
    // 起動
    scheduler.start();
    // running 状態
    expect(scheduler.isRunning()).toBe(true);
    // タイマーが 1 つ登録される
    expect(timer.getTasks().length).toBe(1);
  });

  // start は冪等 (二度目は no-op)
  it("start is idempotent", () => {
    // 生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick: async () => {},
    });
    // 2 回 start
    scheduler.start();
    scheduler.start();
    // タイマーは 1 つだけ
    expect(timer.getTasks().length).toBe(1);
  });

  // tick 完了後に次回 tick が登録される
  it("schedules the next tick after onTick resolves", async () => {
    // onTick の呼び出し回数を記録
    const onTick = vi.fn().mockResolvedValue(undefined);
    // 生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick,
    });
    // 起動
    scheduler.start();
    // 最初のタスクを発火
    const tasks = timer.getTasks();
    expect(tasks.length).toBe(1);
    timer.fire(tasks[0]!.handle);
    // onTick が呼ばれるまで microtask を進める
    await Promise.resolve();
    await Promise.resolve();
    // onTick が 1 回呼ばれた
    expect(onTick).toHaveBeenCalledTimes(1);
    // 次回 tick が登録される
    expect(timer.getTasks().length).toBe(1);
    // 後始末
    scheduler.stop();
  });

  // stop 後の tick はスキップされる
  it("stops scheduling further ticks after stop", async () => {
    // onTick
    const onTick = vi.fn().mockResolvedValue(undefined);
    // 生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick,
    });
    // 起動 → 停止
    scheduler.start();
    expect(timer.getTasks().length).toBe(1);
    scheduler.stop();
    // タイマーは解除される
    expect(timer.getTasks().length).toBe(0);
    // isRunning=false
    expect(scheduler.isRunning()).toBe(false);
  });

  // stop 中に in-flight な tick が走った後でも次回スケジュールしない
  it("does not reschedule when stop was called during in-flight tick", async () => {
    // 完了を制御できる Promise を用意
    let resolveTick!: () => void;
    const tickPromise = new Promise<void>((resolve) => { resolveTick = resolve; });
    // onTick はこの promise が解決されるまでブロック
    const onTick = vi.fn().mockImplementation(() => tickPromise);
    // 生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick,
    });
    // 起動して tick を発火
    scheduler.start();
    const firstHandle = timer.getTasks()[0]!.handle;
    timer.fire(firstHandle);
    // microtask 進める
    await Promise.resolve();
    // tick が in-flight 中に stop
    scheduler.stop();
    // tick 完了を許可
    resolveTick();
    await Promise.resolve();
    await Promise.resolve();
    // running ではない → 次回 tick は scheduleNext で弾かれ予約されない
    expect(scheduler.isRunning()).toBe(false);
    expect(timer.getTasks().length).toBe(0);
  });

  // onTick の throw は onError で観測 (scheduler は止まらない)
  it("routes onTick errors to onError and keeps running", async () => {
    // onError は記録
    const onError = vi.fn();
    // 1 回だけ throw する onTick
    const onTick = vi.fn().mockRejectedValueOnce(new Error("boom"));
    // 生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick,
      onError,
    });
    // 起動して tick 発火
    scheduler.start();
    timer.fire(timer.getTasks()[0]!.handle);
    // microtask
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // onError が呼ばれている
    expect(onError).toHaveBeenCalledTimes(1);
    // 次回 tick が登録されている
    expect(timer.getTasks().length).toBe(1);
    // 後始末
    scheduler.stop();
  });

  // onError 自身が throw しても外に出ない
  it("swallows onError exceptions", async () => {
    // 例外を投げる onError
    const onError = vi.fn(() => {
      throw new Error("onError boom");
    });
    // tick も throw
    const onTick = vi.fn().mockRejectedValue(new Error("tick boom"));
    // 生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick,
      onError,
    });
    // 起動・発火
    scheduler.start();
    timer.fire(timer.getTasks()[0]!.handle);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 何事もなく onError が呼ばれている
    expect(onError).toHaveBeenCalledTimes(1);
    // 後始末
    scheduler.stop();
  });

  // onError 未指定でも例外を握りつぶす
  it("swallows tick errors when onError is not provided", async () => {
    // tick は throw
    const onTick = vi.fn().mockRejectedValue(new Error("tick boom"));
    // onError なしで生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick,
    });
    // 起動・発火
    scheduler.start();
    timer.fire(timer.getTasks()[0]!.handle);
    // microtask
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 次回 tick も登録されている
    expect(timer.getTasks().length).toBe(1);
    // 後始末
    scheduler.stop();
  });

  // stop は冪等
  it("stop is idempotent", () => {
    // 生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick: async () => {},
    });
    // 起動していない状態で stop
    expect(() => scheduler.stop()).not.toThrow();
    // 起動 → stop → 再 stop
    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.stop()).not.toThrow();
  });

  // running=false の状態で発火されてもスキップする
  it("skips tick body when timer fires while not running", async () => {
    // onTick は呼ばれないはず
    const onTick = vi.fn();
    // 生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick,
    });
    // 起動してハンドルを覚える
    scheduler.start();
    const handle = timer.getTasks()[0]!.handle;
    // stop した後に発火
    scheduler.stop();
    timer.fire(handle);
    await Promise.resolve();
    // onTick は呼ばれない
    expect(onTick).not.toHaveBeenCalled();
  });

  // タイマー実装が壊れていて clear が機能しない環境で、コールバックが実行されても scheduler は安全
  it("returns early in timer callback when running flag is already false (broken clear)", async () => {
    // clear が no-op の壊れた timer (cancelled フラグを立てない)
    const tasks: { handle: number; cb: () => void }[] = [];
    let n = 0;
    const brokenTimer = {
      set: (cb: () => void, _ms: number) => {
        const handle = ++n;
        tasks.push({ handle, cb });
        return handle;
      },
      clear: () => {
        // 壊れた clear は何もしない
      },
    };
    // onTick は呼ばれないはず
    const onTick = vi.fn();
    // 生成
    const scheduler = createOutboxScheduler({
      timer: brokenTimer,
      intervalMs: 1000,
      jitterRatio: 0,
      onTick,
    });
    // 起動 → 1 タスク登録
    scheduler.start();
    expect(tasks.length).toBe(1);
    // running を false にしてから fire
    scheduler.stop();
    // clear は no-op なのでタスクは残っている。fire してもタイマーは生きている
    tasks[0]!.cb();
    // onTick は呼ばれない (scheduler.ts:60 の return が機能)
    expect(onTick).not.toHaveBeenCalled();
  });

  // random 未指定でも動作 (Math.random 経由)
  it("uses Math.random when random is not provided", () => {
    // 生成
    const scheduler = createOutboxScheduler({
      timer,
      intervalMs: 1000,
      jitterRatio: 0.5,
      onTick: async () => {},
    });
    // 起動
    scheduler.start();
    // タスクが 1 件あり ms が 1ms 以上
    const tasks = timer.getTasks();
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.ms).toBeGreaterThanOrEqual(1);
    // 後始末
    scheduler.stop();
  });
});
