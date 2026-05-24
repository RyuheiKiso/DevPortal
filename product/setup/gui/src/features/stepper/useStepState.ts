// SetupEvent 配列を Stepper が使いやすいステップ状態に変換するカスタムフック
// Tauri 側の API から流れてくるイベントをステップごとに集約して StepperState を返す

// useMemo フックをインポートする
import { useMemo } from 'react';
// SetupEvent 型をインポートする
import type { SetupEvent } from '../../api/types';

// ステップ単体の実行状態を表す文字列ユニオン型
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

// 出力行のストリーム種別を表す文字列ユニオン型（UI で色分けに使用する）
export type LogStream = 'stdout' | 'stderr' | 'info' | 'warn';

// ステップに紐づく 1 行分の出力エントリ
export interface LogLine {
  // 出力の種別（標準出力 / 標準エラー / 情報メッセージ / 警告）
  stream: LogStream;
  // 出力された 1 行の文字列
  line: string;
}

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
  // stdout/stderr の直近行（最大 MAX_RECENT_LINES 件、実行中サマリ表示用に維持）
  recentLines: string[];
  // ステップに紐づくすべての出力行（失敗時の原因究明用）
  // info / warn は id を持たない場合もあるが、その時点で running の最新ステップに紐づける
  outputLines: LogLine[];
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
  // 全イベントを時系列でテキスト化した文字列（「全ログをコピー」「ログをファイル保存」用）
  allLogs: string;
}

// stdout/stderr のサマリ表示用の直近保持行数（既存 UI の互換維持のため小さい値のまま）
const MAX_RECENT_LINES = 5;

// outputLines のステップごとのメモリ保護上限（極端な暴走を防ぐ）
const MAX_OUTPUT_LINES_PER_STEP = 2000;

// allLogs 集約文字列のメモリ保護上限（行数）
const MAX_ALL_LOGS_LINES = 5000;

// ストリーム種別をログ行のプレフィックスに変換するヘルパー関数
function streamPrefix(stream: LogStream): string {
  // 種別に応じた 3〜4 文字のプレフィックスを返す
  switch (stream) {
    // 標準出力は OUT
    case 'stdout': return 'OUT';
    // 標準エラーは ERR
    case 'stderr': return 'ERR';
    // 情報メッセージは INFO
    case 'info': return 'INFO';
    // 警告は WARN
    case 'warn': return 'WARN';
  }
}

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
  // 直近の running ステップ ID を追跡する（id を持たない info / warn を紐づけるため）
  let currentRunningStepId: string | null = null;
  // 全ログを時系列でテキスト化するための行配列
  const allLogsLines: string[] = [];

  // 1 ステップに 1 行追加するヘルパー関数（上限超過時は古い行を捨てる）
  const appendOutputLine = (step: StepState, stream: LogStream, line: string) => {
    // 新しい行をステップの outputLines に追加する
    step.outputLines.push({ stream, line });
    // 上限を超えた場合は先頭から削除して上限以下に保つ
    if (step.outputLines.length > MAX_OUTPUT_LINES_PER_STEP) {
      // splice で配列先頭から超過分を削除する
      step.outputLines.splice(0, step.outputLines.length - MAX_OUTPUT_LINES_PER_STEP);
    }
  };

  // 全ログテキストに 1 行追加するヘルパー関数（上限超過時は古い行を捨てる）
  const appendAllLog = (stream: LogStream, source: string, line: string) => {
    // プレフィックス・ソース（ステップラベル等）・本文を組み立てる
    allLogsLines.push(`[${streamPrefix(stream)}] ${source ? `(${source}) ` : ''}${line}`);
    // 上限を超えた場合は先頭から削除する
    if (allLogsLines.length > MAX_ALL_LOGS_LINES) {
      // 超過分を先頭から落として上限を維持する
      allLogsLines.splice(0, allLogsLines.length - MAX_ALL_LOGS_LINES);
    }
  };

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
          outputLines: [],
        };
        // マップにステップを登録する（同 ID のステップは上書き）
        stepMap.set(ev.id, step);
        // 同一 ID が既に順序リストにない場合のみ追加する（重複表示を防ぐ）
        if (!stepOrder.includes(ev.id)) {
          stepOrder.push(ev.id);
        }
        // running のときのみ currentRunningStepId を更新する（id 無し info の紐づけ先）
        if (step.status === 'running') {
          currentRunningStepId = ev.id;
        }
        // 全ログにステップ開始マーカーを追記する（時系列追跡用）
        appendAllLog('info', step.label, `▶ ステップ開始 (${ev.index + 1}/${ev.total_steps})`);
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
          // 全ログに完了マーカーを追記する
          appendAllLog('info', step.label, `✔ ステップ完了 (${ev.duration_ms}ms)`);
          // このステップが currentRunningStepId だった場合はクリアする
          if (currentRunningStepId === ev.id) {
            currentRunningStepId = null;
          }
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

      // stdout/stderr イベント: 直近行とフルログの両方を更新する
      case 'stdout':
      case 'stderr': {
        const step = stepMap.get(ev.id);
        if (step) {
          // 既存の直近行配列を更新する（末尾追加 + 上限切り詰め）
          step.recentLines = [...step.recentLines, ev.line].slice(-MAX_RECENT_LINES);
          // フルログにも追加する（失敗時の原因究明用）
          appendOutputLine(step, ev.kind, ev.line);
          // 全ログテキストにも反映する
          appendAllLog(ev.kind, step.label, ev.line);
        }
        break;
      }

      // 警告イベント: id があればステップに警告メッセージとログ行を設定する
      case 'warn': {
        // 紐づけ先のステップを決定する（id 指定があればそれ、なければ現在 running の最新ステップ）
        const targetId = ev.id ?? currentRunningStepId;
        // 紐づけ先のステップを取得する
        const step = targetId ? stepMap.get(targetId) : undefined;
        if (step) {
          // 警告メッセージをステップに設定する（既存挙動の維持）
          step.warn = ev.message;
          // フルログにも警告として追加する
          appendOutputLine(step, 'warn', ev.message);
        }
        // 全ログテキストには紐づけ先の有無に関わらず追加する
        appendAllLog('warn', step?.label ?? '', ev.message);
        break;
      }

      // 情報イベント: id を持たないため現在 running の最新ステップに紐づける
      case 'info': {
        // 紐づけ先のステップを取得する（存在しない場合は全ログのみに追加）
        const step = currentRunningStepId ? stepMap.get(currentRunningStepId) : undefined;
        if (step) {
          // ステップのフルログに追加する
          appendOutputLine(step, 'info', ev.message);
        }
        // 全ログテキストにも追加する
        appendAllLog('info', step?.label ?? '', ev.message);
        break;
      }

      // 正常完了イベント: summary を保存する
      case 'finished': {
        finished = { summary: ev.summary };
        for (const step of stepMap.values()) {
          if (step.status === 'running') {
            step.status = 'done';
          }
        }
        currentRunningStepId = null;
        // 全ログに完了マーカーを追加する
        appendAllLog('info', '', `=== セットアップ完了: ${ev.summary} ===`);
        break;
      }

      // 失敗イベント: error を保存して hasFailed フラグを立てる
      case 'failed': {
        failed = { error: ev.error, recoverable: ev.recoverable };
        // 以降の step_start を skipped にするためフラグを立てる
        hasFailed = true;
        // 直近 running ステップがあれば failed に転換する（status: 'running' のままだと UI が誤誘導する）
        if (currentRunningStepId) {
          // 直近 running ステップを取り出す
          const runningStep = stepMap.get(currentRunningStepId);
          if (runningStep && runningStep.status === 'running') {
            // ステータスを failed に転換して赤表示にする
            runningStep.status = 'failed';
            // 失敗ステップのフルログにもエラー本文を追加する
            appendOutputLine(runningStep, 'stderr', `✘ 失敗: ${ev.error}`);
          }
          // currentRunningStepId をクリアする
          currentRunningStepId = null;
        }
        // 全ログに失敗マーカーを追加する
        appendAllLog('stderr', '', `=== セットアップ失敗: ${ev.error} ===`);
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
    // 全ログを改行で結合した文字列（コピー・ファイル保存用）
    allLogs: allLogsLines.join('\n'),
  };
}

// SetupEvent 配列を StepperState に変換するカスタムフック
export function useStepState(events: SetupEvent[]): StepperState {
  // events が変わったときのみ再計算する（参照同一性で比較）
  return useMemo(() => computeState(events), [events]);
}
