// このファイルはメインダッシュボード画面を表示する React ページコンポーネントを定義する
// ヘッダー・前提条件テーブル・コンポーネントカード一覧を表示する

// React のフックをインポートする
import React, { useState, useEffect, useCallback } from 'react';

// API ラッパ関数をインポートする
import { statusAll, prereqCheck, serviceAction, openLogs } from '../api/tauri';

// 型定義をインポートする
import type { ComponentStatus, ComponentKind, PrereqReport } from '../api/types';

// 共通コンポーネントをインポートする
import { ComponentCard } from '../components/ComponentCard';

// Dashboard ページのプロパティ型定義
interface DashboardProps {
  // インストール画面に遷移するときに呼ぶコールバック（コンポーネント種別を渡す）
  onGoInstall: (component: ComponentKind) => void;
  // アンインストール画面に遷移するときに呼ぶコールバック（コンポーネント種別を渡す）
  onGoUninstall: (component: ComponentKind) => void;
}

// ヘッダーのゴーストボタンに適用するインラインスタイル
const headerBtnStyle: React.CSSProperties = {
  padding: '5px 14px',
  borderRadius: '6px',
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#e2e8f0',
  fontSize: '13px',
  cursor: 'pointer',
  transition: 'background 0.15s',
};

// カードコンテナに適用するインラインスタイル
const sectionCardStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '10px',
  padding: '20px 24px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  border: '1px solid #e2e8f0',
  marginBottom: '20px',
};

// バナー（通知・エラー）のスタイルを生成するヘルパー関数
function bannerStyle(type: 'error' | 'warn' | 'success'): React.CSSProperties {
  // タイプごとに背景色・テキスト色・ボーダー色を切り替える
  const map = {
    // エラーバナーは赤系
    error: { bg: '#fee2e2', color: '#dc2626', border: '#fca5a5' },
    // 警告バナーは黄色系
    warn: { bg: '#fffbeb', color: '#92400e', border: '#fde68a' },
    // 成功バナーは緑系
    success: { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  };
  // 対応する色を取得する
  const c = map[type];
  // スタイルオブジェクトを返す
  return {
    padding: '10px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: c.bg,
    color: c.color,
    border: `1px solid ${c.border}`,
  };
}

// Dashboard: メインダッシュボード画面を表示する関数コンポーネント
export const Dashboard: React.FC<DashboardProps> = ({ onGoInstall, onGoUninstall }) => {
  // コンポーネントのステータスリストを保持する state
  const [statuses, setStatuses] = useState<ComponentStatus[]>([]);
  // ローディング中かどうかを示すフラグ
  const [loading, setLoading] = useState(false);
  // エラーメッセージを保持する state
  const [error, setError] = useState<string | null>(null);
  // 前提条件チェック結果を保持する state
  const [prereqReport, setPrereqReport] = useState<PrereqReport | null>(null);
  // 前提条件チェック中かどうかを示すフラグ
  const [prereqLoading, setPrereqLoading] = useState(false);
  // サービス操作のフィードバックメッセージを保持する state
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  // 前提条件テーブルが折りたたまれているかどうかを管理する state（初期値: 展開）
  const [prereqCollapsed, setPrereqCollapsed] = useState(false);

  // ステータスを取得する関数（初回マウント時とリロードボタン押下時に呼ぶ）
  const loadStatuses = useCallback(async () => {
    // ローディング開始
    setLoading(true);
    // エラーをリセットする
    setError(null);
    try {
      // statusAll() を呼び出して全コンポーネントのステータスを取得する
      const result = await statusAll();
      // 取得したステータスを state に反映する
      setStatuses(result);
    } catch (e) {
      // エラーが発生した場合はエラーメッセージを state にセットする
      setError(`ステータス取得失敗: ${String(e)}`);
    } finally {
      // ローディング終了
      setLoading(false);
    }
  }, []);

  // 初回マウント時にステータスを取得する
  useEffect(() => {
    // loadStatuses を呼び出してステータスを取得する
    loadStatuses();
  }, [loadStatuses]);

  // 前提条件チェックを実行するハンドラ関数
  const handlePrereqCheck = useCallback(async () => {
    // チェック実行時は必ず展開状態にして結果を見せる
    setPrereqCollapsed(false);
    // 前提条件チェック中フラグをセットする
    setPrereqLoading(true);
    // 以前の結果をリセットする
    setPrereqReport(null);
    try {
      // prereqCheck() を呼び出して前提条件チェックを実行する
      const report = await prereqCheck();
      // チェック結果を state にセットする
      setPrereqReport(report);
    } catch (e) {
      // エラーが発生した場合はアクションメッセージに表示する
      setActionMsg(`前提条件チェック失敗: ${String(e)}`);
    } finally {
      // 前提条件チェック中フラグを解除する
      setPrereqLoading(false);
    }
  }, []);

  // サービスを開始するハンドラ関数
  const handleStart = useCallback(async (component: ComponentKind) => {
    try {
      // serviceAction を呼び出してサービスを開始する
      await serviceAction(component, 'start');
      // 成功メッセージをセットする
      setActionMsg(`${component} を開始しました`);
      // ステータスを再取得する
      await loadStatuses();
    } catch (e) {
      // エラーが発生した場合はエラーメッセージをセットする
      setActionMsg(`開始失敗: ${String(e)}`);
    }
  }, [loadStatuses]);

  // サービスを停止するハンドラ関数
  const handleStop = useCallback(async (component: ComponentKind) => {
    try {
      // serviceAction を呼び出してサービスを停止する
      await serviceAction(component, 'stop');
      // 成功メッセージをセットする
      setActionMsg(`${component} を停止しました`);
      // ステータスを再取得する
      await loadStatuses();
    } catch (e) {
      // エラーが発生した場合はエラーメッセージをセットする
      setActionMsg(`停止失敗: ${String(e)}`);
    }
  }, [loadStatuses]);

  // ログフォルダを開くハンドラ関数
  const handleOpenLogs = useCallback(async (component: ComponentKind) => {
    try {
      // openLogs を呼び出してエクスプローラでログフォルダを開く
      await openLogs(component);
    } catch (e) {
      // エラーが発生した場合はエラーメッセージをセットする
      setActionMsg(`ログフォルダを開けませんでした: ${String(e)}`);
    }
  }, []);

  return (
    // アプリ全体を縦方向に並べるコンテナ（ヘッダー + メインを分ける）
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ─── ヘッダーバー ─── */}
      <header style={{
        background: '#1e293b',
        color: '#fff',
        padding: '0 24px',
        height: '52px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
      }}>
        {/* アプリタイトル領域 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* アプリ名 */}
          <span style={{ fontSize: '17px', fontWeight: '700', letterSpacing: '-0.3px' }}>DevPortal</span>
          {/* サブタイトルバッジ */}
          <span style={{
            fontSize: '10px',
            fontWeight: '600',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            color: '#94a3b8',
            background: '#334155',
            padding: '2px 8px',
            borderRadius: '4px',
          }}>
            Setup
          </span>
        </div>

        {/* ヘッダー右側のアクションボタン群 */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* 前提チェックボタン */}
          <button
            onClick={handlePrereqCheck}
            disabled={prereqLoading}
            style={{ ...headerBtnStyle, opacity: prereqLoading ? 0.5 : 1 }}
          >
            {prereqLoading ? '確認中…' : '前提チェック'}
          </button>
          {/* ステータス更新ボタン */}
          <button
            onClick={loadStatuses}
            disabled={loading}
            style={{ ...headerBtnStyle, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? '更新中…' : '↺ 更新'}
          </button>
        </div>
      </header>

      {/* ─── メインコンテンツ ─── */}
      <main style={{ flex: 1, overflow: 'auto', padding: '24px' }}>

        {/* エラーバナー */}
        {error && (
          <div style={bannerStyle('error')}>
            <span>{error}</span>
          </div>
        )}

        {/* アクションフィードバックバナー */}
        {actionMsg && (
          <div style={bannerStyle('warn')}>
            <span>{actionMsg}</span>
            {/* 閉じるボタン */}
            <button
              onClick={() => setActionMsg(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '16px', lineHeight: 1, padding: '0 0 0 12px' }}
            >
              ×
            </button>
          </div>
        )}

        {/* ─── 前提条件セクション（チェック後に表示） ─── */}
        {prereqReport && (
          <section style={sectionCardStyle}>
            {/* セクションヘッダー（クリックで折りたたみ切り替え） */}
            <div
              onClick={() => setPrereqCollapsed(c => !c)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                userSelect: 'none',
                // 展開中はテーブルとの間隔を確保し、折りたたみ時は余白なしにする
                marginBottom: prereqCollapsed ? 0 : '16px',
              }}
            >
              {/* 折りたたみ状態を示す三角アイコン（折りたたみ時に -90° 回転する） */}
              <span style={{
                fontSize: '10px',
                color: '#64748b',
                // CSS transition で回転アニメーションを付ける
                transition: 'transform 0.2s ease',
                transform: prereqCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                display: 'inline-block',
                lineHeight: 1,
              }}>
                ▼
              </span>
              {/* セクションタイトル */}
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: '#0f172a' }}>
                前提条件
              </h2>
              {/* 合否バッジ */}
              <span style={{
                fontSize: '11px',
                fontWeight: '700',
                padding: '2px 10px',
                borderRadius: '9999px',
                background: prereqReport.all_ok ? '#dcfce7' : '#fee2e2',
                color: prereqReport.all_ok ? '#15803d' : '#dc2626',
              }}>
                {prereqReport.all_ok ? 'すべて OK' : '問題あり'}
              </span>
              {/* 折りたたみ時にチェック件数サマリを表示する */}
              {prereqCollapsed && (
                <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: 'auto' }}>
                  {prereqReport.items.filter(i => i.found).length} / {prereqReport.items.length} OK
                </span>
              )}
            </div>

            {/* 展開時のみテーブル本文を描画する（折りたたみ時は非表示） */}
            {!prereqCollapsed && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                  {/* 状態列ヘッダー */}
                  <th style={{ textAlign: 'center', width: '40px', padding: '4px 8px 8px', fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>状態</th>
                  {/* コマンド列ヘッダー */}
                  <th style={{ textAlign: 'left', width: '80px', padding: '4px 16px 8px 8px', fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>コマンド</th>
                  {/* バージョン/案内列ヘッダー */}
                  <th style={{ textAlign: 'left', padding: '4px 8px 8px', fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>バージョン / インストール案内</th>
                </tr>
              </thead>
              <tbody>
                {/* 各前提コマンドの確認結果を 1 行ずつ表示する */}
                {prereqReport.items.map((item) => (
                  <tr key={item.name} style={{ borderBottom: '1px solid #f8fafc' }}>
                    {/* 状態アイコン（✓/✗）を中央に表示する */}
                    <td style={{ textAlign: 'center', padding: '8px' }}>
                      <span style={{
                        fontSize: '15px',
                        fontWeight: '700',
                        // 見つかった場合は緑、見つからない場合は赤で表示する
                        color: item.found ? '#16a34a' : '#dc2626',
                      }}>
                        {item.found ? '✓' : '✗'}
                      </span>
                    </td>
                    {/* コマンド名をモノスペースフォントで表示する */}
                    <td style={{ padding: '8px 16px 8px 8px', fontFamily: 'Consolas, monospace', fontWeight: '600', fontSize: '13px', color: '#1e293b' }}>
                      {item.name}
                    </td>
                    {/* バージョン（見つかった場合）またはインストール案内（見つからない場合）を表示する */}
                    <td style={{ padding: '8px', fontSize: '12px', color: item.found ? '#64748b' : '#dc2626' }}>
                      {item.found
                        // バージョン文字列を表示する（取得できない場合は — で代替する）
                        ? (item.version ?? '—')
                        // インストール案内を表示する
                        : item.install_hint}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </section>
        )}

        {/* ─── コンポーネントセクション ─── */}
        <section>
          {/* セクションヘッダー */}
          <h2 style={{ fontSize: '15px', fontWeight: '600', color: '#0f172a', marginBottom: '14px', marginTop: 0 }}>
            コンポーネント
          </h2>

          {/* コンポーネントカードのグリッドレイアウト */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '16px',
          }}>
            {/* 各コンポーネントのカードを生成する */}
            {statuses.map((status) => (
              <ComponentCard
                key={status.component}
                status={status}
                // インストールボタン押下時に Install ページへ遷移する
                onInstall={() => onGoInstall(status.component)}
                // アンインストールボタン押下時に Uninstall ページへ遷移する
                onUninstall={() => onGoUninstall(status.component)}
                // 開始ボタン押下時にサービスを開始する
                onStart={() => handleStart(status.component)}
                // 停止ボタン押下時にサービスを停止する
                onStop={() => handleStop(status.component)}
                // ログボタン押下時にログフォルダを開く
                onOpenLogs={() => handleOpenLogs(status.component)}
              />
            ))}

            {/* ステータスが空でローディング中でもエラーでもない場合のメッセージ */}
            {statuses.length === 0 && !loading && !error && (
              <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0 }}>
                コンポーネントが見つかりません
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
