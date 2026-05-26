// 公開型を取り込み
import type { OutboxTimer } from "./types.js";

// createOutboxScheduler の入力オプション
export interface CreateOutboxSchedulerOptions {
  // タイマー実装 (set/clear)
  timer: OutboxTimer;
  // tick 間隔の基底 (ms)
  intervalMs: number;
  // ± jitterRatio の割合で interval を揺らす (0..1)
  jitterRatio: number;
  // 乱数源 (テスト用、既定 Math.random)
  random?: () => number;
  // 1 tick で実行する処理本体 (Promise を返す)
  onTick: () => Promise<void>;
  // tick の throw を観測したいなら指定 (任意)
  onError?: (err: unknown) => void;
}

// scheduler の公開 API
export interface OutboxScheduler {
  // 起動 (running なら no-op)
  start(): void;
  // 停止 (次回 set をキャンセル、in-flight tick は最後まで走る)
  stop(): void;
  // 起動中か
  isRunning(): boolean;
}

// 一定間隔で onTick を呼び続ける軽量スケジューラを生成する
// - 既に running なら start は no-op
// - tick は await の後に次回 set (overlapping を防ぐ)
// - stop 後の in-flight tick の throw は onError でのみ通知 (scheduler は止めない)
export function createOutboxScheduler(opts: CreateOutboxSchedulerOptions): OutboxScheduler {
  // 起動状態フラグ
  let running = false;
  // 現在登録されているタイマーハンドル
  let handle: unknown = undefined;
  // 乱数源 (注入 or Math.random)
  const random = opts.random ?? Math.random;
  // jitter 適用後の待機 ms を計算する
  const computeDelay = (): number => {
    // ± jitterRatio の範囲で揺らす
    const delta = opts.intervalMs * opts.jitterRatio * (random() * 2 - 1);
    // 1ms 未満になるのを防ぐ (タイマーが 0 のままだと忙しいループになる)
    return Math.max(1, Math.floor(opts.intervalMs + delta));
  };
  // 次回 tick をスケジュールする (内部関数)
  const scheduleNext = (): void => {
    // running でなければスケジュールしない (stop と同期)
    if (!running) {
      return;
    }
    // 次回までの待機を計算
    const delay = computeDelay();
    // タイマー登録 (実行時に running が降りていればスキップ)
    handle = opts.timer.set(() => {
      // 起動済みでなければ何もしない
      if (!running) {
        return;
      }
      // tick 中フラグはハンドルを undefined にして表現
      handle = undefined;
      // 非同期で onTick を実行し、完了/失敗どちらでも次回をスケジュール
      opts
        .onTick()
        // 例外は onError へ流して握りつぶす (scheduler は止めない)
        .catch((err: unknown) => {
          // onError が指定されていれば通知
          if (opts.onError !== undefined) {
            try {
              opts.onError(err);
            } catch {
              // onError 自身の throw も外に出さない
            }
          }
        })
        // 完了後に次回をスケジュール (running が落ちていればスキップ)
        .finally(() => {
          // running 中であれば次回 tick を予約
          scheduleNext();
        });
    }, delay);
  };
  // 起動 (冪等)
  const start = (): void => {
    // 既に running なら何もしない
    if (running) {
      return;
    }
    // 起動状態に遷移
    running = true;
    // 初回 tick もすぐには走らせず、最初の interval 経過後に開始する
    scheduleNext();
  };
  // 停止 (冪等)
  const stop = (): void => {
    // 既に停止していれば何もしない
    if (!running) {
      return;
    }
    // 停止状態に遷移
    running = false;
    // 登録済みタイマーがあればキャンセル
    if (handle !== undefined) {
      opts.timer.clear(handle);
      handle = undefined;
    }
  };
  // 起動中か
  const isRunning = (): boolean => {
    // フラグをそのまま返す
    return running;
  };
  // 完成オブジェクトを返す
  return { start, stop, isRunning };
}
