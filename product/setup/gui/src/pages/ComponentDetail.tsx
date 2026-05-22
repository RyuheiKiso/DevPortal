// コンポーネント詳細ページコンポーネント
// 単一コンポーネント（Verdaccio / Backstage）のステータス・設定・サービス操作を詳細表示する

// React のフックをインポートする（react-jsx transform を使用しているため React 自体は不要）
import { useState, useEffect, useCallback } from 'react';
// API ラッパー関数をインポートする
import { statusAll, serviceAction, openLogs, loadConfig } from '../api/tauri';
// 型定義をインポートする
import type { ComponentKind, ComponentStatus, SetupConfig } from '../api/types';
// ルーターフックをインポートする（Settings へのジャンプに使用）
import { useRouter } from '../router/router';
// UI プリミティブをインポートする
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { BadgeVariant } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Banner } from '../ui/Banner';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/ToastProvider';
// ページで使用する lucide-react アイコンをインポートする
import {
  // 戻るボタンのアイコン
  ArrowLeft,
  // 開始ボタンのアイコン
  Play,
  // 停止ボタンのアイコン
  Square,
  // 再起動ボタンのアイコン
  RotateCcw,
  // ログを開くボタンのアイコン
  FileText,
  // インストールボタンのアイコン
  Download,
  // アンインストールボタンのアイコン
  Trash2,
  // 設定へジャンプするボタンのアイコン
  Settings,
  // ステータス更新ボタンのアイコン
  RefreshCw,
  // エンドポイント到達可能アイコン
  CheckCircle2,
  // エンドポイント到達不可アイコン
  XCircle,
} from 'lucide-react';
// CSS Modules のスタイルをインポートする
import styles from './ComponentDetail.module.css';

// ComponentDetail ページが受け取る Props 型定義
interface ComponentDetailProps {
  // 表示するコンポーネントの種別
  component: ComponentKind;
  // インストール画面へ遷移するコールバック
  onGoInstall: () => void;
  // アンインストール画面へ遷移するコールバック
  onGoUninstall: () => void;
  // Overview へ戻るコールバック
  onBack: () => void;
}

// コンポーネント種別ごとの表示名マップ
const DISPLAY_NAMES: Record<ComponentKind, string> = {
  // Verdaccio の表示名
  verdaccio: 'Verdaccio',
  // Backstage の表示名
  backstage: 'Backstage',
};

// コンポーネント種別ごとの説明文マップ
const DESCRIPTIONS: Record<ComponentKind, string> = {
  // Verdaccio の説明文
  verdaccio: 'プライベート npm レジストリ',
  // Backstage の説明文
  backstage: '開発者ポータル',
};

// ServiceStatus を Badge の variant とラベルテキストにマッピングするオブジェクト
const STATUS_BADGE_MAP: Record<string, { variant: BadgeVariant; label: string }> = {
  // 実行中: 成功色のバッジ
  running:       { variant: 'success', label: '実行中' },
  // 停止中: 危険色のバッジ
  stopped:       { variant: 'danger',  label: '停止中' },
  // 一時停止: 警告色のバッジ
  paused:        { variant: 'warning', label: '一時停止' },
  // 遷移中: 警告色のバッジ
  pending:       { variant: 'warning', label: '遷移中' },
  // 未インストール: ニュートラルのバッジ
  not_installed: { variant: 'neutral', label: '未インストール' },
  // 不明: ニュートラルのバッジ
  unknown:       { variant: 'neutral', label: '不明' },
};

// コンポーネント詳細ページコンポーネント
export function ComponentDetail({
  component,
  onGoInstall,
  onGoUninstall,
  onBack,
}: ComponentDetailProps) {
  // コンポーネントのステータス情報
  const [status, setStatus] = useState<ComponentStatus | null>(null);
  // セットアップ設定情報
  const [config, setConfig] = useState<SetupConfig | null>(null);
  // データ取得中フラグ
  const [loading, setLoading] = useState(true);
  // データ取得エラーメッセージ
  const [error, setError] = useState<string | null>(null);
  // サービス操作中フラグ（連打防止のため操作中は true）
  const [busy, setBusy] = useState(false);
  // トースト通知関数を取得する
  const { showSuccess, showDanger } = useToast();
  // ルーターを取得する（Settings へのジャンプに使用）
  const { navigate } = useRouter();

  // コンポーネントの表示名を取得する
  const displayName = DISPLAY_NAMES[component];
  // コンポーネントの説明文を取得する
  const description = DESCRIPTIONS[component];

  // ステータスを再取得する（サービス操作後に呼ぶ）
  const refreshStatus = useCallback(async () => {
    try {
      // statusAll を呼び出して全コンポーネントのステータスを取得する
      const all = await statusAll();
      // このコンポーネントのステータスだけ抽出して state を更新する
      setStatus(all.find((s) => s.component === component) ?? null);
    } catch (e) {
      // 更新失敗時はトーストでエラーを通知する
      showDanger(`ステータス更新失敗: ${String(e)}`);
    }
  }, [component, showDanger]);

  // 初回マウント時にステータスと設定を並行取得する
  useEffect(() => {
    // アンマウント後に setState が走らないよう mounted フラグで保護する
    let mounted = true;
    setLoading(true);
    // ステータスと設定を並行して取得する
    Promise.all([statusAll(), loadConfig()])
      .then(([all, cfg]) => {
        // アンマウント済みの場合は state 更新をスキップする
        if (!mounted) return;
        // このコンポーネントのステータスを抽出して state にセットする
        setStatus(all.find((s) => s.component === component) ?? null);
        // 設定情報を state にセットする
        setConfig(cfg);
      })
      .catch((e) => {
        // アンマウント済みの場合は state 更新をスキップする
        if (!mounted) return;
        // 取得失敗時はエラーメッセージを state にセットする
        setError(`データ取得失敗: ${String(e)}`);
      })
      .finally(() => {
        // アンマウント済みの場合は state 更新をスキップする
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [component]);

  // サービスを開始するコールバック（busy フラグで連打防止）
  const handleStart = useCallback(async () => {
    // 既に操作中の場合は実行しない
    if (busy) return;
    // 操作中フラグを立てる
    setBusy(true);
    try {
      // serviceAction で start アクションを実行する
      await serviceAction(component, 'start');
      // 成功トーストを表示する
      showSuccess(`${displayName} を開始しました`);
      // ステータスを再取得して画面を更新する
      await refreshStatus();
    } catch (e) {
      // 失敗時はエラートーストを表示する
      showDanger(`開始失敗: ${String(e)}`);
    } finally {
      // 操作完了後は busy を解除する
      setBusy(false);
    }
  }, [busy, component, displayName, showSuccess, showDanger, refreshStatus]);

  // サービスを停止するコールバック（busy フラグで連打防止）
  const handleStop = useCallback(async () => {
    // 既に操作中の場合は実行しない
    if (busy) return;
    // 操作中フラグを立てる
    setBusy(true);
    try {
      // serviceAction で stop アクションを実行する
      await serviceAction(component, 'stop');
      // 成功トーストを表示する
      showSuccess(`${displayName} を停止しました`);
      // ステータスを再取得して画面を更新する
      await refreshStatus();
    } catch (e) {
      // 失敗時はエラートーストを表示する
      showDanger(`停止失敗: ${String(e)}`);
    } finally {
      // 操作完了後は busy を解除する
      setBusy(false);
    }
  }, [busy, component, displayName, showSuccess, showDanger, refreshStatus]);

  // サービスを再起動するコールバック（busy フラグで連打防止）
  const handleRestart = useCallback(async () => {
    // 既に操作中の場合は実行しない
    if (busy) return;
    // 操作中フラグを立てる
    setBusy(true);
    try {
      // serviceAction で restart アクションを実行する
      await serviceAction(component, 'restart');
      // 成功トーストを表示する
      showSuccess(`${displayName} を再起動しました`);
      // ステータスを再取得して画面を更新する
      await refreshStatus();
    } catch (e) {
      // 失敗時はエラートーストを表示する
      showDanger(`再起動失敗: ${String(e)}`);
    } finally {
      // 操作完了後は busy を解除する
      setBusy(false);
    }
  }, [busy, component, displayName, showSuccess, showDanger, refreshStatus]);

  // ログフォルダを開くコールバック（busy フラグで連打防止）
  const handleOpenLogs = useCallback(async () => {
    // 既に操作中の場合は実行しない
    if (busy) return;
    // 操作中フラグを立てる
    setBusy(true);
    try {
      // openLogs でエクスプローラーにログフォルダを開かせる
      await openLogs(component);
    } catch (e) {
      // 失敗時はエラートーストを表示する
      showDanger(`ログを開けませんでした: ${String(e)}`);
    } finally {
      // 操作完了後は busy を解除する
      setBusy(false);
    }
  }, [busy, component, showDanger]);

  // ローディング中はスケルトンを表示する
  if (loading) {
    return (
      <div className={styles.page}>
        {/* ローディング中はスケルトンで読み込み中状態を示す */}
        <Skeleton height={40} />
        <Skeleton height={120} />
        <Skeleton height={120} />
        <Skeleton height={80} />
      </div>
    );
  }

  // データ取得エラー時はエラーバナーを表示する
  if (error) {
    return (
      <div className={styles.page}>
        <Banner variant="danger" title="データ取得エラー">{error}</Banner>
        {/* 戻るボタンで Overview へ戻れるようにする */}
        <Button variant="ghost" size="sm" onClick={onBack}>
          <Icon icon={ArrowLeft} size={14} />
          Overview へ戻る
        </Button>
      </div>
    );
  }

  // ステータス情報を取得する（null の場合は不明として扱う）
  const badgeInfo = STATUS_BADGE_MAP[status?.service_status ?? 'unknown'] ?? STATUS_BADGE_MAP.unknown;
  // インストール済みかどうかを判定する
  const isInstalled = status?.service_status !== 'not_installed';
  // 実行中かどうかを判定する
  const isRunning = status?.service_status === 'running';

  // このコンポーネントの設定値を取得する（verdaccio / backstage で異なる）
  const componentConfig = component === 'verdaccio' ? config?.verdaccio : config?.backstage;

  // コンポーネント詳細ページを描画する
  return (
    <div className={styles.page}>

      {/* ─── ページヘッダー（戻るボタン + コンポーネント名）─── */}
      <div className={styles.pageHeader}>
        {/* 左側: 戻るボタン */}
        <Button variant="ghost" size="sm" onClick={onBack}>
          <Icon icon={ArrowLeft} size={14} />
          Overview
        </Button>
        {/* 右側: コンポーネント名とステータスバッジ */}
        <div className={styles.titleGroup}>
          {/* ページタイトル（コンポーネント名）*/}
          <h1 className={styles.pageTitle}>{displayName}</h1>
          {/* コンポーネントの説明文 */}
          <span className={styles.pageDesc}>{description}</span>
        </div>
        {/* ステータスバッジ（ドット付き）*/}
        <Badge variant={badgeInfo.variant} dot>{badgeInfo.label}</Badge>
      </div>

      {/* ─── ステータス詳細セクション ─── */}
      <section className={styles.section}>
        {/* セクションラベル */}
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>STATUS</span>
          {/* ステータス更新ボタン */}
          <Button variant="ghost" size="sm" onClick={refreshStatus} disabled={busy}>
            <Icon icon={RefreshCw} size={14} />
            更新
          </Button>
        </div>

        {/* ステータス詳細テーブル */}
        <div className={styles.statusGrid}>
          {/* サービス名の行 */}
          <span className={styles.statusLabel}>サービス名</span>
          <span className={styles.statusMono}>{status?.service_name ?? '—'}</span>

          {/* エンドポイントの行 */}
          <span className={styles.statusLabel}>エンドポイント</span>
          <span className={styles.statusEndpoint}>
            {/* エンドポイント到達可能状態をアイコンで示す */}
            <Icon
              // 到達可能なら成功アイコン、到達不可なら失敗アイコン
              icon={status?.endpoint_reachable ? CheckCircle2 : XCircle}
              size={14}
              // 到達可能なら成功色、到達不可なら危険色
              color={status?.endpoint_reachable ? 'var(--success)' : 'var(--danger)'}
            />
            {/* エンドポイント URL */}
            <span className={styles.statusMono}>{status?.endpoint_url ?? '—'}</span>
          </span>

          {/* データの行 */}
          <span className={styles.statusLabel}>データディレクトリ</span>
          <span>{status?.data_dir_exists ? '存在する' : '未作成'}</span>
        </div>
      </section>

      {/* ─── サービス制御セクション（インストール済みの場合のみ表示）─── */}
      {isInstalled && (
        <section className={styles.section}>
          {/* セクションラベル */}
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>SERVICE CONTROL</span>
          </div>

          {/* 操作ボタン群 */}
          <div className={styles.controlRow}>
            {/* 開始ボタン（実行中は無効）*/}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleStart}
              disabled={isRunning || busy}
            >
              <Icon icon={Play} size={14} />
              開始
            </Button>

            {/* 停止ボタン（停止中は無効）*/}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleStop}
              disabled={!isRunning || busy}
            >
              <Icon icon={Square} size={14} />
              停止
            </Button>

            {/* 再起動ボタン（インストール済みなら常に有効）*/}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRestart}
              disabled={busy}
            >
              <Icon icon={RotateCcw} size={14} />
              再起動
            </Button>

            {/* ログを開くボタン */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenLogs}
              disabled={busy}
            >
              <Icon icon={FileText} size={14} />
              ログ
            </Button>
          </div>
        </section>
      )}

      {/* ─── 設定サマリーセクション（設定が読み込まれた場合のみ表示）─── */}
      {componentConfig && (
        <section className={styles.section}>
          {/* セクションラベルと Settings へのジャンプボタン */}
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>CONFIGURATION</span>
            {/* Settings ページへジャンプするボタン */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ page: 'settings' })}
            >
              <Icon icon={Settings} size={14} />
              設定を編集
            </Button>
          </div>

          {/* 設定値の読み取り専用グリッド */}
          <div className={styles.configGrid}>
            {/* Verdaccio 固有の設定値を表示する */}
            {component === 'verdaccio' && config?.verdaccio && (
              <>
                {/* ポート番号の行 */}
                <span className={styles.configLabel}>ポート</span>
                <span className={styles.configMono}>{config.verdaccio.port}</span>

                {/* バージョン指定の行 */}
                <span className={styles.configLabel}>バージョン</span>
                <span className={styles.configMono}>{config.verdaccio.version}</span>

                {/* アンインストール時のデータ保持設定の行 */}
                <span className={styles.configLabel}>データ保持</span>
                <span>{config.verdaccio.keep_data_on_uninstall ? '保持する' : '削除する'}</span>
              </>
            )}

            {/* Backstage 固有の設定値を表示する */}
            {component === 'backstage' && config?.backstage && (
              <>
                {/* アプリ名の行 */}
                <span className={styles.configLabel}>アプリ名</span>
                <span className={styles.configMono}>{config.backstage.app_name}</span>

                {/* フロントエンドポートの行 */}
                <span className={styles.configLabel}>フロントエンドポート</span>
                <span className={styles.configMono}>{config.backstage.frontend_port}</span>

                {/* バックエンドポートの行 */}
                <span className={styles.configLabel}>バックエンドポート</span>
                <span className={styles.configMono}>{config.backstage.backend_port}</span>

                {/* 起動モードの行 */}
                <span className={styles.configLabel}>起動モード</span>
                <span className={styles.configMono}>{config.backstage.mode}</span>

                {/* アンインストール時のデータ保持設定の行 */}
                <span className={styles.configLabel}>データ保持</span>
                <span>{config.backstage.keep_data_on_uninstall ? '保持する' : '削除する'}</span>
              </>
            )}

            {/* インストールルートの行 */}
            <span className={styles.configLabel}>インストール先</span>
            <span className={styles.configMono}>
              {config?.install_root ?? '%ProgramData%\\DevPortal（既定）'}
            </span>
          </div>
        </section>
      )}

      {/* ─── 操作セクション（インストール / アンインストール）─── */}
      <section className={styles.section}>
        {/* セクションラベル */}
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>OPERATIONS</span>
        </div>

        {/* インストール・アンインストールボタン */}
        <div className={styles.controlRow}>
          {/* インストールボタン（未インストール時のみ有効）*/}
          <Button
            variant="primary"
            size="sm"
            onClick={onGoInstall}
            disabled={isInstalled}
          >
            <Icon icon={Download} size={14} />
            インストール
          </Button>

          {/* アンインストールボタン（インストール済み時のみ有効）*/}
          <Button
            variant="danger"
            size="sm"
            onClick={onGoUninstall}
            disabled={!isInstalled}
          >
            <Icon icon={Trash2} size={14} />
            アンインストール
          </Button>
        </div>
      </section>
    </div>
  );
}
