// 縦タイムライン形式のステッパー UI コンポーネント
// SetupEvent を集約した StepperState を受け取り、進捗・完了・失敗を視覚的に表現する

// useState フックを使ってログ保存状態を保持するためインポートする
import { useState } from 'react';
// lucide-react のアイコンをインポートする
import {
  // 完了ステップのアイコン
  CheckCircle2,
  // 実行中ステップのアイコン（回転アニメーションを付ける）
  Loader2,
  // 失敗ステップのアイコン
  XCircle,
  // スキップ済みステップのアイコン
  MinusCircle,
  // 保留中ステップのアイコン
  Circle,
  // 再試行ボタンのアイコン
  RotateCcw,
  // 戻るボタンのアイコン
  ArrowLeft,
  // コピーボタンのアイコン
  Copy,
  // ログ保存ボタンのアイコン
  Save,
} from 'lucide-react';
// ステップ状態の型定義をインポートする
import type { StepState, StepperState, LogStream } from './useStepState';
// 細線プログレスバーをインポートする
import { LinearProgress } from '../../ui/LinearProgress';
// バナーコンポーネントをインポートする
import { Banner } from '../../ui/Banner';
// ボタンコンポーネントをインポートする
import { Button } from '../../ui/Button';
// アイコンラッパーをインポートする
import { Icon } from '../../ui/Icon';
// CSS Modules のスタイルをインポートする
import styles from './Stepper.module.css';

// Stepper コンポーネントが受け取る Props 型定義
interface StepperProps {
  // useStepState フックが返す全体状態
  state: StepperState;
  // 失敗時の再試行ボタンが押されたときのコールバック（省略時はボタンを表示しない）
  onRetry?: () => void;
  // 「Overview へ戻る」ボタンが押されたときのコールバック（省略時はボタンを表示しない）
  onBack?: () => void;
  // ログをファイルに保存するコールバック（省略時は保存ボタンを表示しない）
  // 引数に全ログ文字列を渡し、戻り値で保存先絶対パスを Promise で返す
  onSaveLog?: (logs: string) => Promise<string>;
}

// durationMs をわかりやすい文字列にフォーマットするヘルパー関数
function formatDuration(ms: number): string {
  // 60 秒以上の場合は「Xm Ys」形式にする
  if (ms >= 60000) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
  }
  // 1 秒以上の場合は「X.Xs」形式にする
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  // 1 秒未満の場合は「0.Xs」形式にする
  return `${(ms / 1000).toFixed(1)}s`;
}

// ステップの状態に応じた CSS クラスを返すヘルパー関数
function getStepContentClass(status: StepState['status']): string {
  switch (status) {
    // スキップ済みは全体を控えめに表示する
    case 'skipped': return styles.contentSkipped;
    // 失敗は危険色で強調する
    case 'failed':  return styles.contentFailed;
    // その他はデフォルトスタイルを使用する
    default:        return '';
  }
}

// ストリーム種別に応じた 1 行の CSS クラスを返すヘルパー関数
function getLogLineClass(stream: LogStream): string {
  switch (stream) {
    // 標準出力は控えめなテキスト色
    case 'stdout': return styles.logLineStdout;
    // 標準エラーは危険色
    case 'stderr': return styles.logLineStderr;
    // 情報は通常色
    case 'info':   return styles.logLineInfo;
    // 警告は警告色
    case 'warn':   return styles.logLineWarn;
  }
}

// ストリーム種別を 3〜4 文字のラベル文字列に変換するヘルパー関数
function getLogStreamLabel(stream: LogStream): string {
  switch (stream) {
    // 標準出力は OUT
    case 'stdout': return 'OUT';
    // 標準エラーは ERR
    case 'stderr': return 'ERR';
    // 情報は INFO
    case 'info':   return 'INFO';
    // 警告は WARN
    case 'warn':   return 'WARN';
  }
}

// ステップのアイコンを描画するサブコンポーネント
function StepIcon({ status }: { status: StepState['status'] }) {
  // 状態ごとに適切なアイコンと色を使い分ける
  switch (status) {
    // 完了: 緑のチェックサークル
    case 'done':
      return <Icon icon={CheckCircle2} size={16} color="var(--success)" />;
    // 実行中: アクセントカラーのスピナー（回転アニメーション付き）
    case 'running':
      return (
        <span
          // spin キーフレームを参照してスピナーを回転させる
          style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}
        >
          <Icon icon={Loader2} size={16} color="var(--accent)" />
        </span>
      );
    // 失敗: 赤の × サークル
    case 'failed':
      return <Icon icon={XCircle} size={16} color="var(--danger)" />;
    // スキップ済み: 控えめな − サークル
    case 'skipped':
      return <Icon icon={MinusCircle} size={16} color="var(--text-subtle)" />;
    // 保留中: 控えめな空サークル
    case 'pending':
    default:
      return <Icon icon={Circle} size={16} color="var(--text-subtle)" />;
  }
}

// 失敗ステップの全ログを折りたたみ表示するサブコンポーネント
// stream 別に色分けした 1 行ずつをコンソール風に並べる
function StepLogConsole({ step }: { step: StepState }) {
  // 出力行が無い場合は何も描画しない（空の details を表示しない）
  if (step.outputLines.length === 0) return null;
  // details/summary で折りたたみ可能なログコンソールを構築する
  return (
    <details className={styles.logConsole} open>
      {/* クリックで開閉できる summary に行数を含めて視認性を高める */}
      <summary className={styles.logConsoleSummary}>
        ログ詳細（{step.outputLines.length} 行）
      </summary>
      {/* 展開時に表示する本体（縦並びのコンソール）*/}
      <div className={styles.logConsoleBody}>
        {step.outputLines.map((entry, li) => (
          // ストリーム種別に応じた色クラスを付与した 1 行を描画する
          <div key={li} className={[styles.logLine, getLogLineClass(entry.stream)].join(' ')}>
            {/* 行先頭にストリーム種別ラベルを表示して種別を一目で分かるようにする */}
            <span className={styles.logStreamLabel}>[{getLogStreamLabel(entry.stream)}]</span>
            {/* ログ本文をそのまま表示する */}
            {entry.line}
          </div>
        ))}
      </div>
    </details>
  );
}

// エラーテキストをクリップボードにコピーするヘルパー関数
function copyToClipboard(text: string) {
  // navigator.clipboard が利用可能な場合はコピーする
  navigator.clipboard.writeText(text).catch(() => {
    // コピー失敗は黙って無視する（Tauri 環境では稀に失敗することがある）
  });
}

// 縦タイムラインのステッパーコンポーネント
export function Stepper({ state, onRetry, onBack, onSaveLog }: StepperProps) {
  // ログ保存成功時の保存先パスを保持する（失敗バナー下に表示する）
  const [savedPath, setSavedPath] = useState<string | null>(null);
  // ログ保存失敗時のエラーメッセージを保持する
  const [saveError, setSaveError] = useState<string | null>(null);

  // ログをファイルに保存するハンドラ（onSaveLog コールバック経由）
  const handleSaveLog = async () => {
    // onSaveLog が未指定なら何もしない（型安全のためのガード）
    if (!onSaveLog) return;
    try {
      // 全ログ文字列を渡してファイル保存を実行する
      const path = await onSaveLog(state.allLogs);
      // 成功時は保存先パスを表示する（エラー表示はクリア）
      setSavedPath(path);
      setSaveError(null);
    } catch (e) {
      // 失敗時はエラーメッセージを表示する（パス表示はクリア）
      setSaveError(String(e));
      setSavedPath(null);
    }
  };

  // ステッパー全体のコンテナを描画する
  return (
    <div className={styles.stepper}>

      {/* ─── ステップリスト（aria-live でスクリーンリーダーに進捗変化を通知する）─── */}
      {/* aria-relevant="additions text" で追加・テキスト変化のみ通知し過剰な読み上げを防ぐ */}
      <div role="list" aria-live="polite" aria-relevant="additions text">
      {state.steps.map((step, i) => {
        // 最後のステップかどうかを判定する（コネクター線の表示に使用）
        const isLast = i === state.steps.length - 1;

        return (
          // ステップのラベルと状態をスクリーンリーダーが読み上げられるよう aria-label を付ける
          <div
            key={step.id}
            className={styles.step}
            role="listitem"
            aria-label={`ステップ: ${step.label} / 状態: ${
              step.status === 'done'    ? '完了'      :
              step.status === 'running' ? '実行中'   :
              step.status === 'failed'  ? '失敗'      :
              step.status === 'skipped' ? 'スキップ済み' :
              '待機中'
            }`}
          >

            {/* 左側のトラック（アイコン + コネクター線）*/}
            <div className={styles.track}>
              {/* ステップのアイコン（状態に応じて切り替わる）*/}
              <div className={styles.bullet}>
                <StepIcon status={step.status} />
              </div>
              {/* コネクター線（最後のステップには表示しない）*/}
              {!isLast && <div className={styles.connector} />}
            </div>

            {/* 右側のコンテンツ（ラベル・進捗・出力行）*/}
            <div
              className={[
                styles.content,
                getStepContentClass(step.status),
              ].filter(Boolean).join(' ')}
            >
              {/* ステップのヘッダー行（ラベル + 状態テキスト）*/}
              <div className={styles.stepHeader}>
                {/* ステップのラベルテキスト */}
                <span className={styles.stepLabel}>{step.label}</span>
                {/* 完了時は所要時間を表示する */}
                {step.status === 'done' && step.durationMs !== undefined && (
                  <span className={styles.stepDuration}>
                    {formatDuration(step.durationMs)}
                  </span>
                )}
                {/* ステップの状態テキストを右端に表示する */}
                <span className={styles.stepStatusText}>
                  {step.status === 'done'    ? '完了'      :
                   step.status === 'running' ? '実行中'   :
                   step.status === 'failed'  ? '失敗'      :
                   step.status === 'skipped' ? 'スキップ' :
                   '待機中'}
                </span>
              </div>

              {/* 実行中のみ: 直近出力行とプログレスバーを表示する */}
              {step.status === 'running' && (
                <div className={styles.stepOutput}>
                  {/* 直近の stdout/stderr 行を表示する */}
                  {step.recentLines.map((line, li) => (
                    <div key={li} className={styles.outputLine}>{line}</div>
                  ))}
                  {/* 進捗率が 0 より大きい場合のみプログレスバーを表示する */}
                  {step.progress > 0 && (
                    <div className={styles.progressWrap}>
                      {/* 細線プログレスバーを描画する */}
                      <LinearProgress percent={step.progress} />
                      {/* 進捗率を数値で表示する */}
                      <span className={styles.progressPct}>{step.progress}%</span>
                    </div>
                  )}
                </div>
              )}

              {/* 失敗ステップは折りたたみログコンソールで全ログを表示する（原因究明用）*/}
              {step.status === 'failed' && <StepLogConsole step={step} />}

              {/* 警告メッセージが設定されていれば表示する */}
              {step.warn && (
                <div className={styles.warnMessage}>{step.warn}</div>
              )}
            </div>
          </div>
        );
      })}
      </div>

      {/* ─── 完了バナー（finished イベント受信後に表示する）─── */}
      {/* aria-live="polite" でスクリーンリーダーに結果が出たことを通知する */}
      {state.finished && (
        <div className={styles.result} aria-live="polite" role="status">
          {/* 成功バナー（サマリーテキストを表示する）*/}
          <Banner variant="success" title="セットアップ完了">
            {state.finished.summary}
          </Banner>
          {/* 完了後のアクションボタン群 */}
          <div className={styles.resultActions}>
            {/* Overview へ戻るボタン（コールバックが設定されている場合のみ表示）*/}
            {onBack && (
              <Button variant="secondary" size="sm" onClick={onBack}>
                <Icon icon={ArrowLeft} size={14} />
                Overview へ戻る
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ─── 失敗バナー（failed イベント受信後に表示する）─── */}
      {/* aria-live="assertive" で失敗をスクリーンリーダーに即座に通知する */}
      {state.failed && (
        <div className={styles.result} aria-live="assertive" role="alert">
          {/* 失敗バナー（エラーメッセージを表示する）*/}
          <Banner variant="danger" title="セットアップ失敗">
            {state.failed.error}
          </Banner>
          {/* 失敗後のアクションボタン群 */}
          <div className={styles.resultActions}>
            {/* エラーコピーボタン（エラーテキストのみをクリップボードにコピーする）*/}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(state.failed?.error ?? '')}
            >
              <Icon icon={Copy} size={14} />
              エラーをコピー
            </Button>
            {/* 全ログコピーボタン（時系列の info/stdout/stderr/warn をすべてコピーする）*/}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(state.allLogs)}
            >
              <Icon icon={Copy} size={14} />
              全ログをコピー
            </Button>
            {/* ログをファイル保存ボタン（onSaveLog コールバックが渡されている場合のみ表示）*/}
            {onSaveLog && (
              <Button variant="ghost" size="sm" onClick={handleSaveLog}>
                <Icon icon={Save} size={14} />
                ログをファイル保存
              </Button>
            )}
            {/* 再試行ボタン（recoverable かつコールバックが設定されている場合のみ表示）*/}
            {state.failed.recoverable && onRetry && (
              <Button variant="primary" size="sm" onClick={onRetry}>
                <Icon icon={RotateCcw} size={14} />
                再試行
              </Button>
            )}
            {/* Overview へ戻るボタン（コールバックが設定されている場合のみ表示）*/}
            {onBack && (
              <Button variant="secondary" size="sm" onClick={onBack}>
                <Icon icon={ArrowLeft} size={14} />
                Overview へ戻る
              </Button>
            )}
          </div>
          {/* 保存成功時の保存先パスを表示する（再保存できるよう常時更新される）*/}
          {savedPath && (
            <div className={styles.savedPathHint}>
              ログを保存しました: {savedPath}
            </div>
          )}
          {/* 保存失敗時のエラーメッセージを表示する */}
          {saveError && (
            <div className={styles.saveErrorHint}>
              ログ保存に失敗しました: {saveError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
