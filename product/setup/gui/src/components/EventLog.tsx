// このファイルはセットアップ進捗ログを表示する React コンポーネントを定義する
// events 配列を順順（最新が下）に表示し、イベント種別ごとにスタイルを変える

// React をインポートする（JSX 変換と useEffect フックに必要）
import React, { useEffect, useRef } from 'react';

// 型定義をインポートする
import type { SetupEvent } from '../api/types';

// EventLog のプロパティ型定義
interface EventLogProps {
  // 表示するセットアップイベントの配列
  events: SetupEvent[];
}

// SetupEvent を表示用テキスト文字列に変換するヘルパー関数
function formatEvent(ev: SetupEvent): string {
  // イベント種別ごとに適切な表示テキストを返す
  switch (ev.kind) {
    // ステップ開始イベントの表示テキストを返す
    case 'step_start':
      return `[${ev.index + 1}/${ev.total_steps}] ${ev.label}`;
    // ステップ完了イベントの表示テキストを返す
    case 'step_done':
      return `完了 (${ev.duration_ms}ms)`;
    // 進捗イベントの表示テキストを返す
    case 'progress':
      return `進捗: ${ev.percent}%${ev.message ? ` - ${ev.message}` : ''}`;
    // 標準出力イベントの表示テキストを返す
    case 'stdout':
      return ev.line;
    // 標準エラー出力イベントの表示テキストを返す
    case 'stderr':
      return ev.line;
    // 警告イベントの表示テキストを返す
    case 'warn':
      return `[警告] ${ev.message}`;
    // 情報イベントの表示テキストを返す
    case 'info':
      return `[情報] ${ev.message}`;
    // 完了イベントの表示テキストを返す
    case 'finished':
      return `完了: ${ev.summary}`;
    // 失敗イベントの表示テキストを返す
    case 'failed':
      return `失敗: ${ev.error}`;
    // 未知のイベントの場合は JSON 文字列として表示する
    default:
      return JSON.stringify(ev);
  }
}

// イベント種別ごとのインラインスタイルを返すヘルパー関数
function getEventStyle(ev: SetupEvent): React.CSSProperties {
  // イベント種別ごとにスタイルオブジェクトを返す
  switch (ev.kind) {
    // ステップ開始は太字で表示する
    case 'step_start':
      return { fontWeight: 'bold', color: '#1d4ed8' };
    // 完了は緑色で表示する
    case 'finished':
      return { color: '#16a34a', fontWeight: 'bold' };
    // 失敗は赤色で表示する
    case 'failed':
      return { color: '#dc2626', fontWeight: 'bold' };
    // 警告はオレンジ色で表示する
    case 'warn':
      return { color: '#d97706' };
    // 標準出力・標準エラー出力はグレー小文字で表示する
    case 'stdout':
    case 'stderr':
      return { color: '#9ca3af', fontSize: '12px' };
    // その他のイベントはデフォルトスタイルで表示する
    default:
      return { color: '#374151' };
  }
}

// EventLog: セットアップ進捗ログを表示する関数コンポーネント
export const EventLog: React.FC<EventLogProps> = ({ events }) => {
  // ログコンテナの末尾への参照（自動スクロールに使用）
  const bottomRef = useRef<HTMLDivElement>(null);

  // events が更新されたときに末尾へ自動スクロールする
  useEffect(() => {
    // bottomRef が存在する場合は末尾へスクロールする
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  return (
    // ログコンテナ（最大高さと縦スクロールを設定）
    <div
      style={{
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        padding: '8px',
        maxHeight: '300px',
        overflowY: 'auto',
        background: '#f9fafb',
        fontFamily: 'monospace',
        fontSize: '13px',
      }}
    >
      {/* イベントが存在しない場合はメッセージを表示する */}
      {events.length === 0 && (
        <span style={{ color: '#9ca3af' }}>ログがありません</span>
      )}

      {/* イベントを順順（最新が下）に表示する */}
      {events.map((ev, i) => (
        <div
          key={i}
          style={{
            padding: '2px 0',
            borderBottom: '1px solid #e5e7eb',
            ...getEventStyle(ev),
          }}
        >
          {/* イベントを表示用テキストに変換して表示する */}
          {formatEvent(ev)}
        </div>
      ))}

      {/* 自動スクロール用のアンカー要素 */}
      <div ref={bottomRef} />
    </div>
  );
};
