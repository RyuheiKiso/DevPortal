// このファイルはアンインストール画面を表示する React ページコンポーネントを定義する
// Install.tsx と対称な構造で keep_data フラグの切り替えも提供する

// React のフックをインポートする
import React, { useState, useCallback, useEffect } from 'react';

// API ラッパ関数をインポートする
import { uninstallComponent, loadConfig } from '../api/tauri';

// 型定義をインポートする
import type { ComponentKind, SetupConfig, SetupEvent } from '../api/types';

// 共通コンポーネントをインポートする
import { EventLog } from '../components/EventLog';
import { ProgressBar } from '../components/ProgressBar';

// Uninstall ページのプロパティ型定義
interface UninstallProps {
  // アンインストールするコンポーネントの種別
  component: ComponentKind;
  // 戻るボタンが押されたときに呼ぶコールバック
  onBack: () => void;
}

// ページコンテンツ全体のラッパースタイル
const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  overflow: 'hidden',
};

// ヘッダーバーのスタイル
const headerStyle: React.CSSProperties = {
  background: '#1e293b',
  color: '#fff',
  padding: '0 24px',
  height: '52px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexShrink: 0,
  boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
};

// メインコンテンツ領域のスタイル
const mainStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '24px',
  maxWidth: '720px',
  margin: '0 auto',
  width: '100%',
};

// アンインストール画面で使用するデフォルト設定（loadConfig 完了前のフォールバック）
const defaultConfig: SetupConfig = {
  // Windows サービス名のプレフィックス
  service_prefix: 'DevPortal',
  // インストールルートは null（%ProgramData%\DevPortal を使用する）
  install_root: null,
  // Verdaccio のデフォルト設定
  verdaccio: { port: 4873, version: '^5', keep_data_on_uninstall: true },
  // Backstage のデフォルト設定
  backstage: {
    app_name: 'devportal-backstage',
    frontend_port: 3000,
    backend_port: 7007,
    keep_data_on_uninstall: true,
    mode: 'dev',
  },
};

// Uninstall: アンインストール画面を表示する関数コンポーネント
export const Uninstall: React.FC<UninstallProps> = ({ component, onBack }) => {
  // 収集したセットアップイベントを保持する state
  const [events, setEvents] = useState<SetupEvent[]>([]);
  // 現在の進捗率を保持する state
  const [progress, setProgress] = useState<number>(0);
  // アンインストール中かどうかを示すフラグ
  const [running, setRunning] = useState(false);
  // アンインストール結果のメッセージを保持する state
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  // アンインストール完了かどうかを示すフラグ
  const [done, setDone] = useState(false);
  // データディレクトリを保持するかどうかのフラグ（デフォルト: 保持する）
  const [keepData, setKeepData] = useState(true);
  // 現在の設定（install_root を含む）
  const [config, setConfig] = useState<SetupConfig>(defaultConfig);

  // 画面表示時に setup.toml から設定を読み込む（install_root を表示するため）
  useEffect(() => {
    // Rust 側の cmd_load_config を呼び出して設定を取得する
    loadConfig().then(setConfig).catch(() => {
      // 読み込み失敗時はデフォルト設定のまま継続する
    });
  }, []);

  // コンポーネント名を表示用に変換する
  const displayName = component === 'verdaccio' ? 'Verdaccio' : 'BackStage';

  // アンインストールを開始するハンドラ関数
  const handleUninstall = useCallback(async () => {
    // アンインストール開始時に state をリセットする
    setEvents([]);
    setProgress(0);
    setResultMsg(null);
    setDone(false);
    // アンインストール中フラグをセットする
    setRunning(true);

    // イベントを受け取るコールバック関数
    const onEvent = (ev: SetupEvent) => {
      // events 配列にイベントを追加する
      setEvents((prev) => [...prev, ev]);
      // progress イベントの場合は進捗率を更新する
      if (ev.kind === 'progress') {
        setProgress(ev.percent);
      }
      // finished イベントの場合は完了メッセージをセットする
      if (ev.kind === 'finished') {
        setResultMsg(`アンインストール完了: ${ev.summary}`);
        setDone(true);
      }
      // failed イベントの場合は失敗メッセージをセットする
      if (ev.kind === 'failed') {
        setResultMsg(`アンインストール失敗: ${ev.error}`);
        setDone(true);
      }
    };

    try {
      // uninstallComponent を呼び出してアンインストールを実行する（読み込んだ config を渡す）
      await uninstallComponent(component, keepData, onEvent, config);
    } catch (e) {
      // エラーが発生した場合は結果メッセージに表示する
      setResultMsg(`エラー: ${String(e)}`);
      setDone(true);
    } finally {
      // アンインストール中フラグを解除する
      setRunning(false);
    }
  }, [component, keepData, config]);

  // 成功かどうかを判定する
  const isSuccess = done && resultMsg?.startsWith('アンインストール完了');

  return (
    // ページ全体のコンテナ（ヘッダー + メイン）
    <div style={pageStyle}>

      {/* ─── ヘッダーバー ─── */}
      <header style={headerStyle}>
        {/* 戻るボタン */}
        <button
          onClick={onBack}
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.2)',
            color: '#e2e8f0',
            padding: '5px 14px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '13px',
            fontFamily: 'inherit',
          }}
        >
          ← ダッシュボードへ戻る
        </button>
        {/* ページタイトル */}
        <span style={{ fontSize: '15px', fontWeight: '600' }}>
          {displayName} のアンインストール
        </span>
        {/* 右側のスペーサー（タイトルを中央寄せに見せる） */}
        <span style={{ width: '140px' }} />
      </header>

      {/* ─── メインコンテンツ ─── */}
      <main style={mainStyle}>

        {/* インストール先ディレクトリの表示（読み取り専用） */}
        <div style={{
          marginBottom: '16px',
          padding: '12px 16px',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          {/* セクションラベル */}
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
            アンインストール対象ディレクトリ
          </div>
          {/* 現在の install_root を読み取り専用で表示する */}
          <div style={{ fontSize: '13px', color: '#334155', fontFamily: 'inherit' }}>
            {config.install_root ?? (
              <span style={{ color: '#94a3b8' }}>
                %ProgramData%\DevPortal（既定）
              </span>
            )}
          </div>
        </div>

        {/* データ保持オプションのチェックボックス */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '20px',
          padding: '14px 16px',
          background: '#fffbeb',
          border: '1px solid #fde68a',
          borderRadius: '8px',
          fontSize: '13px',
          color: '#92400e',
        }}>
          {/* データ保持チェックボックス */}
          <input
            type="checkbox"
            id="keepData"
            checked={keepData}
            onChange={(e) => setKeepData(e.target.checked)}
            disabled={running}
            style={{ width: '16px', height: '16px', cursor: running ? 'not-allowed' : 'pointer', accentColor: '#d97706' }}
          />
          {/* チェックボックスのラベル */}
          <label htmlFor="keepData" style={{ cursor: running ? 'not-allowed' : 'pointer', fontWeight: '500' }}>
            データディレクトリを保持する（Verdaccio のパッケージ・設定を残す）
          </label>
        </div>

        {/* アンインストール開始ボタン */}
        <div style={{ marginBottom: '20px' }}>
          <button
            onClick={handleUninstall}
            disabled={running}
            style={{
              padding: '10px 24px',
              borderRadius: '8px',
              border: 'none',
              background: running ? '#e2e8f0' : '#dc2626',
              color: running ? '#94a3b8' : '#fff',
              cursor: running ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '600',
              fontFamily: 'inherit',
              boxShadow: running ? 'none' : '0 2px 4px rgba(220,38,38,0.3)',
            }}
          >
            {running ? 'アンインストール中…' : 'アンインストール開始'}
          </button>
        </div>

        {/* アンインストール中のプログレスバー */}
        {running && (
          <div style={{ marginBottom: '16px' }}>
            <ProgressBar percent={progress} label="アンインストール進捗" />
          </div>
        )}

        {/* アンインストール結果メッセージ */}
        {resultMsg && (
          <div style={{
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '13px',
            background: isSuccess ? '#dcfce7' : '#fee2e2',
            color: isSuccess ? '#15803d' : '#dc2626',
            border: `1px solid ${isSuccess ? '#86efac' : '#fca5a5'}`,
          }}>
            {resultMsg}
          </div>
        )}

        {/* セットアップイベントログ */}
        <h3 style={{ fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          実行ログ
        </h3>
        <EventLog events={events} />
      </main>
    </div>
  );
};
