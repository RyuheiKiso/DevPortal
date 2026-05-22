// アンインストール実行画面コンポーネント
// テキスト確認入力・データ保持オプション・進捗をステッパー UI で表示する

// React のフックをインポートする（react-jsx transform を使用しているため React 自体は不要）
import { useState, useCallback, useEffect } from 'react';
// API ラッパー関数をインポートする
import { uninstallComponent, loadConfig } from '../api/tauri';
// 型定義をインポートする
import type { ComponentKind, SetupConfig, SetupEvent } from '../api/types';
// ステップ状態フックをインポートする
import { useStepState } from '../features/stepper/useStepState';
// ステッパー UI をインポートする
import { Stepper } from '../features/stepper/Stepper';
// UI プリミティブをインポートする
import { Button } from '../ui/Button';
import { Banner } from '../ui/Banner';
import { Icon } from '../ui/Icon';
// ページのアイコンをインポートする
import { Trash2, ArrowLeft } from 'lucide-react';
// CSS Modules のスタイルをインポートする
import styles from './Uninstall.module.css';

// Uninstall ページが受け取る Props 型定義
interface UninstallProps {
  // アンインストールするコンポーネントの種別
  component: ComponentKind;
  // 戻るボタンが押されたときに呼ぶコールバック
  onBack: () => void;
}

// フロントエンド側のデフォルト設定（loadConfig 完了前のフォールバック）
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

// コンポーネント種別ごとの表示名マップ
const DISPLAY_NAMES: Record<ComponentKind, string> = {
  // Verdaccio の表示名
  verdaccio: 'Verdaccio',
  // Backstage の表示名
  backstage: 'Backstage',
};

// アンインストール画面コンポーネント
export function Uninstall({ component, onBack }: UninstallProps) {
  // 受信したセットアップイベントの配列（Stepper に渡す）
  const [events, setEvents] = useState<SetupEvent[]>([]);
  // アンインストール実行中フラグ
  const [running, setRunning] = useState(false);
  // データディレクトリを保持するかどうかのフラグ（デフォルト: 保持する）
  const [keepData, setKeepData] = useState(true);
  // テキスト確認入力フィールドの値（コンポーネント名が入力されると実行可能になる）
  const [confirmText, setConfirmText] = useState('');
  // 現在の設定（アンインストール先のパスを表示するために読み込む）
  const [config, setConfig] = useState<SetupConfig>(defaultConfig);

  // useStepState フックで SetupEvent 配列をステップ状態に変換する
  const stepState = useStepState(events);

  // コンポーネントの表示名を取得する
  const displayName = DISPLAY_NAMES[component];

  // 確認入力がコンポーネント名と一致するかどうかを判定する
  const isConfirmed = confirmText === component;

  // 画面マウント時に setup.toml から設定を読み込む
  useEffect(() => {
    // Rust 側の cmd_load_config を呼び出して設定を取得する
    loadConfig().then(setConfig).catch(() => {
      // 読み込み失敗時はデフォルト設定のまま継続する（致命的ではない）
    });
  }, []);

  // アンインストールを実行するコールバック
  const handleUninstall = useCallback(async () => {
    // テキスト確認が完了していない場合は何もしない（二重チェック）
    if (!isConfirmed) return;

    // イベント配列をリセットする
    setEvents([]);
    // 実行中フラグを立てる
    setRunning(true);

    // イベントを受け取るコールバック関数
    const onEvent = (ev: SetupEvent) => {
      // events 配列にイベントを追加する
      setEvents((prev) => [...prev, ev]);
    };

    try {
      // uninstallComponent を呼び出してアンインストールを実行する
      await uninstallComponent(component, keepData, onEvent, config);
    } catch (e) {
      // 予期しないエラーは failed イベントとして追加する
      setEvents((prev) => [
        ...prev,
        {
          kind: 'failed',
          component,
          action: 'uninstall',
          error: String(e),
          recoverable: false,
        },
      ]);
    } finally {
      // 実行中フラグを解除する
      setRunning(false);
    }
  }, [component, keepData, config, isConfirmed]);

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
        <h1 className={styles.pageTitle}>{displayName} の削除</h1>
      </div>

      {/* ─── 操作確認フォーム（実行前のみ表示する）─── */}
      {!stepState.isDone && (
        <>
          {/* 破壊的操作の警告バナー */}
          <Banner variant="warning" title="注意">
            この操作は元に戻せません。サービスの停止・ファイルの削除が行われます。
          </Banner>

          {/* アンインストール対象ディレクトリの表示（読み取り専用）*/}
          <section className={styles.section}>
            {/* セクションラベル */}
            <span className={styles.sectionLabel}>削除対象ディレクトリ</span>
            {/* install_root のパスを読み取り専用で表示する */}
            <span className={styles.dirDisplay}>
              {config.install_root ?? '%ProgramData%\\DevPortal（既定）'}
            </span>
          </section>

          {/* データ保持オプションのチェックボックスセクション */}
          <section className={styles.section}>
            {/* セクションラベル */}
            <span className={styles.sectionLabel}>データの扱い</span>
            {/* データ保持チェックボックスの行 */}
            <label className={styles.checkboxRow}>
              {/* チェックボックス本体 */}
              <input
                type="checkbox"
                // 現在の keepData 値でチェック状態を制御する
                checked={keepData}
                // 変更時に keepData を更新する
                onChange={(e) => setKeepData(e.target.checked)}
                // 実行中は変更できないようにする
                disabled={running}
                // チェックボックスのスタイルクラスを適用する
                className={styles.checkbox}
              />
              {/* チェックボックスのラベルテキスト */}
              <span className={styles.checkboxLabel}>
                データを保持する（{displayName} の設定・データを残す）
              </span>
            </label>
          </section>

          {/* テキスト確認入力セクション（コンポーネント名の入力で実行が有効になる）*/}
          <section className={styles.section}>
            {/* セクションラベル（入力するべき文字列を教示する）*/}
            <span className={styles.sectionLabel}>
              確認のため <code className={styles.code}>{component}</code> と入力してください
            </span>
            {/* テキスト確認入力フィールド */}
            <input
              type="text"
              // 入力値を confirmText で管理する
              value={confirmText}
              // 変更時に confirmText を更新する
              onChange={(e) => setConfirmText(e.target.value)}
              // 実行中は変更できないようにする
              disabled={running}
              // プレースホルダーテキスト（入力例を示す）
              placeholder={component}
              // 入力フィールドのスタイルクラスを適用する
              className={styles.confirmInput}
            />
          </section>

          {/* アンインストール実行ボタン */}
          <div className={styles.startRow}>
            <Button
              variant="danger"
              size="md"
              onClick={handleUninstall}
              // テキスト確認が未完了か実行中の場合は無効にする
              disabled={!isConfirmed || running}
            >
              <Icon icon={Trash2} size={14} />
              {running ? 'アンインストール中…' : `${displayName} を削除する`}
            </Button>
          </div>
        </>
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
            // アンインストールは再試行不可のためコールバックは渡さない
            onRetry={undefined}
            // 完了・失敗後に Overview へ戻れるようにコールバックを渡す
            onBack={onBack}
          />
        </section>
      )}
    </div>
  );
}
