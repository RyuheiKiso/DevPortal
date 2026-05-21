// このファイルはインストール画面を表示する React ページコンポーネントを定義する
// コンポーネントを選択してインストールを開始し、進捗を EventLog に表示する

// React のフックをインポートする
import React, { useState, useCallback, useEffect } from 'react';

// API ラッパ関数をインポートする
import { installComponent, loadConfig, saveConfig, pickDirectory } from '../api/tauri';

// 型定義をインポートする
import type { ComponentKind, SetupConfig, SetupEvent } from '../api/types';

// 共通コンポーネントをインポートする
import { EventLog } from '../components/EventLog';
import { ProgressBar } from '../components/ProgressBar';

// Install ページのプロパティ型定義
interface InstallProps {
  // インストールするコンポーネントの種別
  component: ComponentKind;
  // 戻るボタンが押されたときに呼ぶコールバック
  onBack: () => void;
}

// デフォルト設定（フロントエンドから渡す SetupConfig の初期値）
const defaultConfig: SetupConfig = {
  // Windows サービス名のプレフィックス
  service_prefix: 'DevPortal',
  // インストールルートは null（%ProgramData%\DevPortal を使用する）
  install_root: null,
  // Verdaccio のデフォルト設定
  verdaccio: {
    port: 4873,
    version: '^5',
    keep_data_on_uninstall: true,
  },
  // Backstage のデフォルト設定
  backstage: {
    app_name: 'devportal-backstage',
    frontend_port: 3000,
    backend_port: 7007,
    keep_data_on_uninstall: true,
    mode: 'dev',
  },
};

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

// Install: インストール画面を表示する関数コンポーネント
export const Install: React.FC<InstallProps> = ({ component, onBack }) => {
  // 収集したセットアップイベントを保持する state
  const [events, setEvents] = useState<SetupEvent[]>([]);
  // 現在の進捗率を保持する state
  const [progress, setProgress] = useState<number>(0);
  // インストール中かどうかを示すフラグ
  const [running, setRunning] = useState(false);
  // インストール結果のメッセージを保持する state
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  // インストール完了かどうかを示すフラグ
  const [done, setDone] = useState(false);
  // 現在の設定（setup.toml から読み込む）
  const [config, setConfig] = useState<SetupConfig>(defaultConfig);

  // 画面表示時に setup.toml から設定を読み込む
  useEffect(() => {
    // Rust 側の cmd_load_config を呼び出して設定を取得する
    loadConfig().then(setConfig).catch(() => {
      // 読み込み失敗時はデフォルト設定のまま継続する
    });
  }, []);

  // コンポーネント名を表示用に変換する
  const displayName = component === 'verdaccio' ? 'Verdaccio' : 'BackStage';

  // フォルダ選択ダイアログを開くハンドラ関数
  const handlePickDir = useCallback(async () => {
    // ネイティブフォルダ選択ダイアログを表示する（現在の install_root をデフォルトパスとする）
    const picked = await pickDirectory(config.install_root ?? undefined);
    // フォルダが選択された場合は config を更新する
    if (picked) {
      setConfig((c) => ({ ...c, install_root: picked }));
    }
  }, [config.install_root]);

  // インストール先をデフォルトに戻すハンドラ関数
  const handleResetDir = useCallback(() => {
    // install_root を null に戻す（%ProgramData%\DevPortal が使用される）
    setConfig((c) => ({ ...c, install_root: null }));
  }, []);

  // インストールを開始するハンドラ関数
  const handleInstall = useCallback(async () => {
    // インストール開始時に state をリセットする
    setEvents([]);
    setProgress(0);
    setResultMsg(null);
    setDone(false);
    // インストール中フラグをセットする
    setRunning(true);

    // インストール開始前に設定を保存する（次回起動時に反映される）
    await saveConfig(config).catch(() => {
      // 保存失敗は致命的ではないので無視する
    });

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
        setResultMsg(`インストール完了: ${ev.summary}`);
        setDone(true);
      }
      // failed イベントの場合は失敗メッセージをセットする
      if (ev.kind === 'failed') {
        setResultMsg(`インストール失敗: ${ev.error}`);
        setDone(true);
      }
    };

    try {
      // installComponent を呼び出してインストールを実行する（現在の config を渡す）
      await installComponent(component, config, onEvent);
    } catch (e) {
      // エラーが発生した場合は結果メッセージに表示する
      setResultMsg(`エラー: ${String(e)}`);
      setDone(true);
    } finally {
      // インストール中フラグを解除する
      setRunning(false);
    }
  }, [component, config]);

  // 成功かどうかを判定する（結果メッセージが「完了」で始まるかどうか）
  const isSuccess = done && resultMsg?.startsWith('インストール完了');

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
          {displayName} のインストール
        </span>
        {/* 右側のスペーサー（タイトルを中央寄せに見せる） */}
        <span style={{ width: '140px' }} />
      </header>

      {/* ─── メインコンテンツ ─── */}
      <main style={mainStyle}>

        {/* インストール先ディレクトリ選択セクション */}
        <div style={{
          marginBottom: '20px',
          padding: '16px',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          {/* セクションラベル */}
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
            インストール先
          </div>
          {/* パス表示 + ボタン行 */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* 現在選択されているパス（読み取り専用テキストボックス） */}
            <input
              type="text"
              readOnly
              value={config.install_root ?? ''}
              placeholder="%ProgramData%\\DevPortal（既定）"
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                fontSize: '13px',
                color: config.install_root ? '#0f172a' : '#94a3b8',
                fontFamily: 'inherit',
                cursor: 'default',
              }}
            />
            {/* フォルダ選択ボタン */}
            <button
              onClick={handlePickDir}
              disabled={running}
              style={{
                padding: '7px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: running ? '#f1f5f9' : '#fff',
                color: running ? '#94a3b8' : '#334155',
                cursor: running ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              選択…
            </button>
            {/* 既定に戻すボタン（install_root が設定されている場合のみ表示する） */}
            {config.install_root && (
              <button
                onClick={handleResetDir}
                disabled={running}
                style={{
                  padding: '7px 14px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: running ? '#f1f5f9' : '#fff',
                  color: running ? '#94a3b8' : '#64748b',
                  cursor: running ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                既定に戻す
              </button>
            )}
          </div>
          {/* 補足テキスト（未指定の場合のデフォルトパスを案内する） */}
          {!config.install_root && (
            <div style={{ marginTop: '6px', fontSize: '12px', color: '#94a3b8' }}>
              未指定の場合は <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: '3px' }}>%ProgramData%\DevPortal</code> にインストールされます
            </div>
          )}
        </div>

        {/* インストール開始ボタン */}
        <div style={{ marginBottom: '20px' }}>
          <button
            onClick={handleInstall}
            disabled={running}
            style={{
              padding: '10px 24px',
              borderRadius: '8px',
              border: 'none',
              background: running ? '#e2e8f0' : '#2563eb',
              color: running ? '#94a3b8' : '#fff',
              cursor: running ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '600',
              fontFamily: 'inherit',
              boxShadow: running ? 'none' : '0 2px 4px rgba(37,99,235,0.3)',
            }}
          >
            {running ? 'インストール中…' : 'インストール開始'}
          </button>
        </div>

        {/* インストール中のプログレスバー */}
        {running && (
          <div style={{ marginBottom: '16px' }}>
            <ProgressBar percent={progress} label="インストール進捗" />
          </div>
        )}

        {/* インストール結果メッセージ */}
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
