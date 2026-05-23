// セットアップイベントの生ログを等幅フォントで表示するコンポーネント
// events 配列を時系列（下が最新）でリスト表示し、イベント種別ごとに色分けする

// useEffect / useRef フックをインポートする
import { useEffect, useRef } from 'react';
// SetupEvent 型をインポートする
import type { SetupEvent } from '../../api/types';
// CSS Modules のスタイルをインポートする
import styles from './RawLog.module.css';

// RawLog コンポーネントが受け取る Props の型定義
interface RawLogProps {
  // 表示するセットアップイベントの配列
  events: SetupEvent[];
}

// SetupEvent を表示用テキスト文字列に変換するヘルパー関数
function formatEvent(ev: SetupEvent): string {
  // イベント種別ごとに適切な表示テキストを返す
  switch (ev.kind) {
    // ステップ開始: 番号とラベルを表示する
    case 'step_start':  return `[${ev.index + 1}/${ev.total_steps}] ${ev.label}`;
    // ステップ完了: 所要時間を表示する
    case 'step_done':   return `✓ 完了 (${ev.duration_ms}ms)`;
    // 進捗: 進捗率とメッセージを表示する
    case 'progress':    return `${ev.percent}%${ev.message ? ` ${ev.message}` : ''}`;
    // 標準出力: そのまま表示する
    case 'stdout':      return ev.line;
    // 標準エラー出力: そのまま表示する
    case 'stderr':      return ev.line;
    // 警告: プレフィックスを付けて表示する
    case 'warn':        return `[WARN] ${ev.message}`;
    // 情報: プレフィックスを付けて表示する
    case 'info':        return `[INFO] ${ev.message}`;
    // 正常完了: サマリーを表示する
    case 'finished':    return `✓ ${ev.summary}`;
    // 失敗: エラーメッセージを表示する
    case 'failed':      return `✗ ${ev.error}`;
    // 未知のイベント: JSON で表示する
    default:            return JSON.stringify(ev);
  }
}

// イベント種別に応じた追加 CSS クラス名を返すヘルパー関数
function getLineClass(ev: SetupEvent): string {
  // イベント種別ごとに対応するスタイルクラスを返す
  switch (ev.kind) {
    // ステップ開始はアクセントカラーで強調する
    case 'step_start':  return styles.lineAccent;
    // 正常完了は成功色で表示する
    case 'finished':    return styles.lineSuccess;
    // 失敗は危険色で表示する
    case 'failed':      return styles.lineDanger;
    // 警告は警告色で表示する
    case 'warn':        return styles.lineWarn;
    // stdout/stderr は控えめな色で表示する
    case 'stdout':
    case 'stderr':      return styles.lineMuted;
    // その他はデフォルトスタイルを使用する
    default:            return '';
  }
}

// 生ログを時系列で表示するコンポーネント
export function RawLog({ events }: RawLogProps) {
  // ログ末尾へ自動スクロールするための ref
  const bottomRef = useRef<HTMLDivElement>(null);

  // events が更新されるたびに末尾へ自動スクロールする
  useEffect(() => {
    // bottomRef が存在する場合は末尾へスクロールする
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // ログ全体のコンテナを描画する
  return (
    <div className={styles.log}>
      {/* ログが空の場合はプレースホルダーテキストを表示する */}
      {events.length === 0 && (
        <span className={styles.empty}>ログがありません</span>
      )}

      {/* イベントを時系列（上が古い順）で表示する */}
      {events.map((ev, i) => (
        <div
          // インデックスをキーに使用する
          key={i}
          // 基本スタイルとイベント種別スタイルを結合する
          className={[styles.line, getLineClass(ev)].filter(Boolean).join(' ')}
        >
          {/* イベントを表示用テキストに変換して描画する */}
          {formatEvent(ev)}
        </div>
      ))}

      {/* 自動スクロールのアンカー要素 */}
      <div ref={bottomRef} />
    </div>
  );
}
