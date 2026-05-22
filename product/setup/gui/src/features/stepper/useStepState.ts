// SetupEvent 配列を Stepper が使いやすいステップ状態に変換するカスタムフック
// Tauri 側の API から流れてくるイベントをステップごとに集約して StepperState を返す

// useMemo フックをインポートする
import { useMemo } from 'react';
// SetupEvent 型をインポートする
import type { SetupEvent } from '../../api/types';

// ステップ単体の実行状態を表す文字列ユニオン型
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

// 1 ステップの集約状態を表すインターフェース
export interface StepState {
  // Rust 側の step_start.id と一致するステップ識別子
  id: string;
  // ステッパーに表示するラベルテキスト
  label: string;
  // ステップのインデックス（0 始まり）
  index: number;
  // 全ステップ数
  totalSteps: number;
  // 現在の実行状態
  status: StepStatus;
  // step_done イベントで設定される所要時間（ミリ秒）
  durationMs?: number;
  // progress イベントで更新される進捗率（0〜100）
  progress: number;
  // progress イベントで設定される進捗メッセージ
  progressMessage: string | null;
  // stdout/stderr の直近行（最大 MAX_LINES 件）
  recentLines: string[];
  // warn イベントで設定される警告メッセージ
  warn?: string;
}

// Stepper 全体の状態を表すインターフェース
export interface StepperState {
  // 各ステップの状態リスト（step_start の順序で並ぶ）
  steps: StepState[];
  // finished イベント受信後に設定される正常完了情報
  finished?: { summary: string };
  // failed イベント受信後に設定される失敗情報
  failed?: { error: string; recoverable: boolean };
  // 現在実行中（finished / failed のどちらも未受信）かどうか
  isRunning: boolean;
  // 完了済み（finished または failed を受信済み）かどうか
  isDone: boolean;
}

// stdout/stderr の保持最大行数
const MAX_LINES = 5;

// SetupEvent 配列から StepperState を計算する純粋関数（useMemo に渡す）
function computeState(events: SetupEvent[]): StepperState {
  // ステップを id → StepState のマップで管理する
  const stepMap = new Map<string, StepState>();
  // ステップの追加順序を保持するリスト
  const stepOrder: string[] = [];
  // 失敗またはスキップ済みかどうかを追跡する（後続ステップを skipped にするため）
  let hasFailed = false;
  // finished イベントの情報を保持する
  let finished: StepperState['finished'];
  // failed イベントの情報を保持する
  let failed: StepperState['failed'];

  // イベントを時系列順に処理して StepState を更新する
  for (const ev of events) {
    switch (ev.kind) {

      // ステップ開始イベント: 新しい StepState を登録する
      case 'step_start': {
        const step: StepState = {
          id: ev.id,
          label: ev.label,
          index: ev.index,
          totalSteps: ev.total_steps,
          // 失敗済みの場合は skipped に、それ以外は running にする
          status: hasFailed ? 'skipped' : 'running',
          progress: 0,
          progressMessage: null,
          recentLines: [],
        };
        // マップにステップを登録する
        stepMap.set(ev.id, step);
        // 順序リストに追加する
        stepOrder.push(ev.id);
        break;
      }

      // ステップ完了イベント: status と所要時間を更新する
      case 'step_done': {
        const step = stepMap.get(ev.id);
        if (step) {
          // done 状態に更新する
          step.status = 'done';
          // 所要時間を記録する
          step.durationMs = ev.duration_ms;
        }
        break;
      }

      // 進捗イベント: 進捗率とメッセージを更新する
      case 'progress': {
        const step = stepMap.get(ev.id);
        if (step) {
          // 進捗率を更新する（0〜100）
          step.progress = ev.percent;
          // 進捗メッセージを更新する
          step.progressMessage = ev.message;
        }
        break;
      }

      // stdout/stderr イベント: 直近行を追加する（最大 MAX_LINES 件に切り詰める）
      case 'stdout':
      case 'stderr': {
        const step = stepMap.get(ev.id);
        if (step) {
          // 末尾に追加して最大件数を超えた分を先頭から除去する
          step.recentLines = [...step.recentLines, ev.line].slice(-MAX_LINES);
        }
        break;
      }

      // 警告イベント: id があればステップに警告メッセージを設定する
      case 'warn': {
        if (ev.id) {
          const step = stepMap.get(ev.id);
          if (step) step.warn = ev.message;
        }
        break;
      }

      // 正常完了イベント: summary を保存する
      case 'finished': {
        finished = { summary: ev.summary };
        break;
      }

      // 失敗イベント: error を保存して hasFailed フラグを立てる
      case 'failed': {
        failed = { error: ev.error, recoverable: ev.recoverable };
        // 以降の step_start を skipped にするためフラグを立てる
        hasFailed = true;
        break;
      }
    }
  }

  // stepOrder に従って StepState の配列を構築する（順序保証）
  const steps = stepOrder.map(id => stepMap.get(id)!);

  return {
    steps,
    finished,
    failed,
    // finished / failed の両方が未設定なら実行中とみなす
    isRunning: !finished && !failed,
    // いずれかが設定されていれば完了済みとみなす
    isDone: !!finished || !!failed,
  };
}

// SetupEvent 配列を StepperState に変換するカスタムフック
export function useStepState(events: SetupEvent[]): StepperState {
  // events が変わったときのみ再計算する（参照同一性で比較）
  return useMemo(() => computeState(events), [events]);
}
