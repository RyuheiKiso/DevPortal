// このファイルはコンポーネントの状態カードを表示する React コンポーネントを定義する
// Verdaccio / Backstage の状態とアクションボタンを 1 枚のカードで表示する

// React をインポートする（JSX 変換に必要）
import React from 'react';

// 型定義をインポートする
import type { ComponentStatus, ServiceStatus } from '../api/types';

// ComponentCard のプロパティ型定義
interface ComponentCardProps {
  // 表示するコンポーネントのステータス情報
  status: ComponentStatus;
  // インストールボタンが押されたときに呼ぶコールバック
  onInstall: () => void;
  // アンインストールボタンが押されたときに呼ぶコールバック
  onUninstall: () => void;
  // 開始ボタンが押されたときに呼ぶコールバック
  onStart: () => void;
  // 停止ボタンが押されたときに呼ぶコールバック
  onStop: () => void;
  // ログボタンが押されたときに呼ぶコールバック
  onOpenLogs: () => void;
}

// サービス状態に対応するバッジ情報（ラベル・背景色・テキスト色）を返すヘルパー関数
function getStatusBadge(status: ServiceStatus): { label: string; bg: string; color: string } {
  // サービス状態ごとに表示情報を決定する
  switch (status) {
    // 実行中は緑系バッジ
    case 'running':
      return { label: '実行中', bg: '#dcfce7', color: '#15803d' };
    // 停止中は赤系バッジ
    case 'stopped':
      return { label: '停止中', bg: '#fee2e2', color: '#dc2626' };
    // 一時停止中はオレンジ系バッジ
    case 'paused':
      return { label: '一時停止', bg: '#ffedd5', color: '#c2410c' };
    // 遷移中は黄色系バッジ
    case 'pending':
      return { label: '遷移中', bg: '#fef9c3', color: '#a16207' };
    // 未インストールは灰色バッジ
    case 'not_installed':
      return { label: '未インストール', bg: '#f1f5f9', color: '#64748b' };
    // 不明な状態も灰色バッジで表示する
    default:
      return { label: '不明', bg: '#f1f5f9', color: '#64748b' };
  }
}

// サービス状態に対応するカード左ボーダーの色を返すヘルパー関数
function getStatusBorderColor(status: ServiceStatus): string {
  // サービス状態ごとに左ボーダーの色を返す
  switch (status) {
    // 実行中は緑
    case 'running': return '#22c55e';
    // 停止中は赤
    case 'stopped': return '#ef4444';
    // 一時停止中はオレンジ
    case 'paused': return '#f97316';
    // 遷移中は黄色
    case 'pending': return '#eab308';
    // 未インストール・不明は灰色
    default: return '#cbd5e1';
  }
}

// ボタンのベーススタイルを生成するヘルパー関数
function makeBtn(
  bg: string,
  color: string,
  border: string,
  disabled: boolean,
): React.CSSProperties {
  // 無効状態のときはグレーアウトする
  return {
    padding: '5px 12px',
    borderRadius: '6px',
    border: `1px solid ${disabled ? '#e2e8f0' : border}`,
    background: disabled ? '#f8fafc' : bg,
    color: disabled ? '#94a3b8' : color,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '12px',
    fontWeight: '500',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
    opacity: disabled ? 0.6 : 1,
    whiteSpace: 'nowrap' as const,
  };
}

// ComponentCard: コンポーネントの状態カードを表示する関数コンポーネント
export const ComponentCard: React.FC<ComponentCardProps> = ({
  status,
  onInstall,
  onUninstall,
  onStart,
  onStop,
  onOpenLogs,
}) => {
  // サービス状態のバッジ情報を取得する
  const badge = getStatusBadge(status.service_status);
  // カード左ボーダーの色を取得する
  const borderColor = getStatusBorderColor(status.service_status);

  // コンポーネント名を表示用に変換する（verdaccio → Verdaccio）
  const displayName =
    status.component === 'verdaccio' ? 'Verdaccio' : 'BackStage';

  // コンポーネントの説明文を取得する
  const description =
    status.component === 'verdaccio'
      // Verdaccio の説明
      ? 'プライベート npm レジストリ'
      // BackStage の説明
      : '開発者ポータル';

  // サービスがインストールされているかどうかを判定する
  const isInstalled = status.service_status !== 'not_installed';

  // サービスが実行中かどうかを判定する
  const isRunning = status.service_status === 'running';

  return (
    // カード全体のコンテナ（左ボーダーで状態を色で示す）
    <div style={{
      background: '#ffffff',
      borderRadius: '10px',
      border: '1px solid #e2e8f0',
      // 左ボーダーをサービス状態の色で表示する
      borderLeft: `4px solid ${borderColor}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
    }}>

      {/* ─── カードヘッダー（名前・説明・バッジ） ─── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        {/* 左側：コンポーネント名と説明 */}
        <div>
          {/* コンポーネント名の見出し */}
          <h2 style={{ margin: '0 0 2px', fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>
            {displayName}
          </h2>
          {/* コンポーネントの説明文 */}
          <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>{description}</p>
        </div>
        {/* 右側：サービス状態バッジ */}
        <span style={{
          fontSize: '11px',
          fontWeight: '700',
          padding: '3px 10px',
          borderRadius: '9999px',
          background: badge.bg,
          color: badge.color,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}>
          {badge.label}
        </span>
      </div>

      {/* ─── 詳細情報 ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', color: '#64748b' }}>
        {/* サービス名の表示 */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* ラベル */}
          <span style={{ fontWeight: '500', minWidth: '90px', color: '#475569' }}>サービス名</span>
          {/* 値（モノスペースフォントで表示する） */}
          <span style={{ fontFamily: 'Consolas, monospace', fontSize: '11px' }}>{status.service_name}</span>
        </div>
        {/* エンドポイント URL の表示 */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* ラベル */}
          <span style={{ fontWeight: '500', minWidth: '90px', color: '#475569' }}>エンドポイント</span>
          {/* 到達可能かどうかで色を変えて表示する */}
          <span style={{ color: status.endpoint_reachable ? '#16a34a' : '#94a3b8' }}>
            {/* 到達可能インジケーター */}
            <span style={{ marginRight: '4px' }}>{status.endpoint_reachable ? '●' : '○'}</span>
            {status.endpoint_url}
          </span>
        </div>
        {/* データディレクトリの存在状態を表示する */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* ラベル */}
          <span style={{ fontWeight: '500', minWidth: '90px', color: '#475569' }}>データ</span>
          {/* 存在するかどうかを表示する */}
          <span>{status.data_dir_exists ? '存在する' : '未作成'}</span>
        </div>
      </div>

      {/* ─── アクションボタン群 ─── */}
      <div style={{
        display: 'flex',
        gap: '6px',
        flexWrap: 'wrap',
        paddingTop: '12px',
        // ボーダーで詳細情報と区切る
        borderTop: '1px solid #f1f5f9',
      }}>
        {/* インストールボタン（未インストール時のみ有効） */}
        <button
          onClick={onInstall}
          disabled={isInstalled}
          style={makeBtn('#2563eb', '#fff', '#2563eb', isInstalled)}
        >
          インストール
        </button>

        {/* アンインストールボタン（インストール済み時のみ有効） */}
        <button
          onClick={onUninstall}
          disabled={!isInstalled}
          style={makeBtn('#fee2e2', '#dc2626', '#fca5a5', !isInstalled)}
        >
          アンインストール
        </button>

        {/* 開始ボタン（インストール済みかつ停止中のみ有効） */}
        <button
          onClick={onStart}
          disabled={!isInstalled || isRunning}
          style={makeBtn('#dcfce7', '#15803d', '#86efac', !isInstalled || isRunning)}
        >
          ▶ 開始
        </button>

        {/* 停止ボタン（実行中のみ有効） */}
        <button
          onClick={onStop}
          disabled={!isRunning}
          style={makeBtn('#ffedd5', '#c2410c', '#fdba74', !isRunning)}
        >
          ■ 停止
        </button>

        {/* ログボタン（常に有効） */}
        <button
          onClick={onOpenLogs}
          style={makeBtn('#f8fafc', '#475569', '#e2e8f0', false)}
        >
          ログを開く
        </button>
      </div>
    </div>
  );
};
