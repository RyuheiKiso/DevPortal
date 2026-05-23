// インストール実行画面コンポーネント
// インストール先の設定・実行・進捗をステッパー UI で表示する

// React のフックをインポートする（react-jsx transform を使用しているため React 自体は不要）
import { useState, useCallback, useEffect } from 'react';
// API ラッパー関数をインポートする
import { installComponent, loadConfig, saveConfig, pickDirectory } from '../api/tauri';
// 型定義をインポートする
import type { ComponentKind, SetupConfig, SetupEvent } from '../api/types';
// ステップ状態フックをインポートする
import { useStepState } from '../features/stepper/useStepState';
// ステッパー UI をインポートする
import { Stepper } from '../features/stepper/Stepper';
// UI プリミティブをインポートする
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
// ページのアイコンをインポートする
import { FolderOpen, RotateCcw, Play, ArrowLeft } from 'lucide-react';
// CSS Modules のスタイルをインポートする
import styles from './Install.module.css';

// Install ページが受け取る Props 型定義
interface InstallProps {
  // インストールするコンポーネントの種別
  component: ComponentKind;
  // 戻るボタンが押されたときに呼ぶコールバック
  onBack: () => void;
}

// コンポーネント種別ごとの表示名マップ
const DISPLAY_NAMES: Record<ComponentKind, string> = {
  // Verdaccio の表示名
  verdaccio: 'Verdaccio',
  // Backstage の表示名
  backstage: 'Backstage',
  // BaGet の表示名
  baget: 'BaGet',
  // PostgreSQL の表示名
  postgres: 'PostgreSQL',
  // SQL Server の表示名
  sqlserver: 'SQL Server',
};

// インストール画面コンポーネント
export function Install({ component, onBack }: InstallProps) {
  // 受信したセットアップイベントの配列（Stepper に渡す）
  const [events, setEvents] = useState<SetupEvent[]>([]);
  // インストール実行中フラグ
  const [running, setRunning] = useState(false);
  // 現在の設定（null = loadConfig 完了前、デフォルト値が一瞬見えるフラッシュを防ぐ）
  const [config, setConfig] = useState<SetupConfig | null>(null);

  // useStepState フックで SetupEvent 配列をステップ状態に変換する
  const stepState = useStepState(events);

  // コンポーネントの表示名を取得する
  const displayName = DISPLAY_NAMES[component];

  // 画面マウント時に setup.toml から設定を読み込む
  useEffect(() => {
    // アンマウント後に setConfig が走らないよう mounted フラグで保護する
    let mounted = true;
    loadConfig()
      .then((cfg) => {
        // アンマウント済みの場合は state 更新をスキップしてフォルダ選択結果を上書きしない
        if (mounted) setConfig(cfg);
      })
      .catch(() => {
        // 読み込み失敗時はデフォルト設定のまま継続する（致命的ではない）
      });
    return () => { mounted = false; };
  }, []);

  // フォルダ選択ダイアログを開くコールバック
  const handlePickDir = useCallback(async () => {
    // config 未ロードの場合は操作しない
    if (!config) return;
    // ネイティブフォルダ選択ダイアログを表示する
    const picked = await pickDirectory(config.install_root ?? undefined);
    // フォルダが選択された場合のみ config を更新する
    if (picked) {
      setConfig((c) => c ? { ...c, install_root: picked } : c);
    }
  }, [config]);

  // インストール先をデフォルトに戻すコールバック
  const handleResetDir = useCallback(() => {
    // install_root を null に戻す（%ProgramData%\DevPortal が使用される）
    setConfig((c) => c ? { ...c, install_root: null } : c);
  }, []);

  // インストールを実行するコールバック（再試行時にも使用する）
  const handleInstall = useCallback(async () => {
    // イベント配列と実行フラグをリセットする
    setEvents([]);
    // 実行中フラグを立てる
    setRunning(true);

    // config が未ロードの場合は実行しない
    if (!config) { setRunning(false); return; }

    // インストール開始前に設定を保存する（次回起動時に反映される）
    await saveConfig(config).catch(() => {
      // 保存失敗は致命的ではないので無視する
    });

    // イベントを受け取るコールバック関数
    const onEvent = (ev: SetupEvent) => {
      // events 配列にイベントを追加する
      setEvents((prev) => [...prev, ev]);
    };

    try {
      // installComponent を呼び出してインストールを実行する
      await installComponent(component, config, onEvent);
    } catch (e) {
      // 予期しないエラーは failed イベントとして追加する
      setEvents((prev) => [
        ...prev,
        {
          kind: 'failed',
          component,
          action: 'install',
          error: String(e),
          recoverable: true,
        },
      ]);
    } finally {
      // 実行中フラグを解除する
      setRunning(false);
    }
  }, [component, config]);

  // ページ全体を描画する
  return (
    <div className={styles.page}>

      {/* ─── ページヘッダー（タイトル + 戻るボタン）─── */}
      <div className={styles.pageHeader}>
        {/* 左側: 戻るボタン */}
        <Button variant="ghost" size="sm" onClick={onBack} disabled={running}>
          <Icon icon={ArrowLeft} size={14} />
          Overview
        </Button>
        {/* 右側: ページタイトル */}
        <h1 className={styles.pageTitle}>{displayName} インストール</h1>
      </div>

      {/* ─── インストール先ディレクトリ選択セクション（実行前のみ編集可能）─── */}
      {!stepState.isDone && (
        <section className={styles.section}>
          {/* セクションラベル */}
          <span className={styles.sectionLabel}>インストール先</span>

          {/* config 未ロード中はスケルトンを表示してデフォルト値のフラッシュを防ぐ */}
          {config === null ? (
            <Skeleton height={32} />
          ) : (
            /* パス表示 + 操作ボタンの行 */
            <div className={styles.dirRow}>
              {/* 現在選択されているインストール先パスを読み取り専用で表示する */}
              <span className={config.install_root ? styles.dirPath : styles.dirPlaceholder}>
                {config.install_root ?? '%ProgramData%\\DevPortal（既定）'}
              </span>

              {/* フォルダ選択ボタン */}
              <Button variant="secondary" size="sm" onClick={handlePickDir} disabled={running}>
                <Icon icon={FolderOpen} size={14} />
                選択…
              </Button>

              {/* install_root が設定されている場合のみ「既定に戻す」ボタンを表示する */}
              {config.install_root && (
                <Button variant="ghost" size="sm" onClick={handleResetDir} disabled={running}>
                  <Icon icon={RotateCcw} size={14} />
                  既定に戻す
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {/* ─── インストール開始ボタン（実行前のみ表示する）─── */}
      {!stepState.isDone && (
        <div className={styles.startRow}>
          <Button
            variant="primary"
            size="md"
            onClick={handleInstall}
            // 設定未ロードまたはインストール実行中は無効にする
            disabled={running || config === null}
          >
            <Icon icon={Play} size={14} />
            {running ? 'インストール中…' : 'インストール開始'}
          </Button>
        </div>
      )}

      {/* ─── ステッパー（events がある場合のみ表示する）─── */}
      {events.length > 0 && (
        <section className={styles.section}>
          {/* セクションラベル */}
          <span className={styles.sectionLabel}>進捗</span>
          {/* ステッパー UI（ステップごとの進捗を縦タイムラインで表示する）*/}
          <Stepper
            // useStepState が返す全体状態を渡す
            state={stepState}
            // 失敗時に再試行できるようにコールバックを渡す
            onRetry={handleInstall}
            // 完了・失敗後に Overview へ戻れるようにコールバックを渡す
            onBack={onBack}
          />
        </section>
      )}
    </div>
  );
}
