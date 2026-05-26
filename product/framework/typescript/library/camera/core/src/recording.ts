// 状態遷移の許容遷移表
import type { RecordingState } from "./types.js";
// 状態遷移違反時に投げるエラー
import { RecordingError } from "./errors.js";

// 各状態から遷移可能な next state の集合
const TRANSITIONS: Readonly<Record<RecordingState, ReadonlySet<RecordingState>>> = {
  // 待機中 → recording のみ（start で）
  idle: new Set<RecordingState>(["recording"]),
  // 録画中 → paused / idle（pause / stop で）
  recording: new Set<RecordingState>(["paused", "idle"]),
  // 一時停止中 → recording / idle（resume / stop で）
  paused: new Set<RecordingState>(["recording", "idle"]),
};

// 録画状態の小さな state machine
export class RecordingStateMachine {
  // 現在の状態
  private current: RecordingState = "idle";

  // 現在状態を取得
  get state(): RecordingState {
    // private を直接公開しないように getter 経由
    return this.current;
  }

  // 次の状態への遷移を試行する（不正遷移なら RecordingError）
  transitionTo(next: RecordingState): void {
    // 同じ状態への遷移は何もしない（idempotent）
    if (this.current === next) {
      return;
    }
    // 許容遷移表から検査
    const allowed = TRANSITIONS[this.current];
    // 許容されていなければエラー
    if (!allowed.has(next)) {
      // reason を含む RecordingError を投げる
      throw new RecordingError("INVALID_TRANSITION", {
        message: `Invalid recording transition: ${this.current} -> ${next}`,
      });
    }
    // 状態を更新
    this.current = next;
  }

  // 強制リセット（dispose / エラー復旧用、状態違反を起こさない）
  reset(): void {
    // idle に戻す
    this.current = "idle";
  }
}
