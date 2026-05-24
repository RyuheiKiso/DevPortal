// コンポーネントの状態と操作ボタンを表示するカードコンポーネント
// Verdaccio / Backstage / BaGet のサービスステータス・エンドポイント・データ状態とアクションを提供する

// CSS Modules のスタイルをインポートする
import styles from './ComponentCard.module.css';
// 型定義をインポートする
import type { ComponentStatus, ServiceStatus } from '../../api/types';
// UI プリミティブをインポートする
import { Badge } from '../../ui/Badge';
import type { BadgeVariant } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
// アクションボタンに使用する lucide-react アイコンをインポートする
import { Play, Square, FileText, Download, Trash2, ExternalLink } from 'lucide-react';
// ブラウザ起動 API をインポートする
import { openInBrowser } from '../../api/tauri';

// ServiceStatus を Badge の variant とラベルテキストにマッピングするオブジェクト
const STATUS_BADGE_MAP: Record<ServiceStatus, { variant: BadgeVariant; label: string }> = {
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

// ServiceStatus に対応するカード左ボーダーの CSS クラスを返すヘルパー関数
function getStatusClass(status: ServiceStatus): string {
  // 状態ごとに対応する CSS クラスを返す
  switch (status) {
    // 実行中は成功色の左ボーダー
    case 'running': return styles.statusRunning;
    // 停止中は危険色の左ボーダー
    case 'stopped': return styles.statusStopped;
    // 一時停止は警告色の左ボーダー
    case 'paused':  return styles.statusPaused;
    // 遷移中は警告色の左ボーダー
    case 'pending': return styles.statusPending;
    // 未インストール・不明はデフォルト（グレー）の左ボーダー
    default:        return styles.statusDefault;
  }
}

// ComponentCard コンポーネントが受け取る Props 型
interface ComponentCardProps {
  // 表示するコンポーネントのステータス情報
  status: ComponentStatus;
  // このカードのサービス操作が実行中かどうか（true の場合は操作ボタンを disable する）
  busy?: boolean;
  // コンポーネント名クリック時に詳細ページへ遷移するコールバック
  onDetail?: () => void;
  // インストールボタンが押されたときのコールバック
  onInstall: () => void;
  // アンインストールボタンが押されたときのコールバック
  onUninstall: () => void;
  // 開始ボタンが押されたときのコールバック
  onStart: () => void;
  // 停止ボタンが押されたときのコールバック
  onStop: () => void;
  // ログボタンが押されたときのコールバック
  onOpenLogs: () => void;
}

// コンポーネント種別ごとの表示名マップ
const DISPLAY_NAMES: Record<string, string> = {
  // Verdaccio の表示名
  verdaccio: 'Verdaccio',
  // Backstage の表示名
  backstage:  'Backstage',
  // BaGet の表示名
  baget: 'BaGet',
  // PostgreSQL の表示名
  postgres: 'PostgreSQL',
  // SQL Server の表示名
  sqlserver: 'SQL Server',
};

// コンポーネント種別ごとの説明文マップ
const DESCRIPTIONS: Record<string, string> = {
  // Verdaccio の説明文
  verdaccio: 'プライベート npm レジストリ',
  // Backstage の説明文
  backstage:  '開発者ポータル',
  // BaGet の説明文
  baget: 'プライベート NuGet レジストリ',
  // PostgreSQL の説明文
  postgres: 'リレーショナルデータベース',
  // SQL Server の説明文
  sqlserver: 'Microsoft SQL Server データベース',
};

// コンポーネントの状態カードコンポーネント
export function ComponentCard({
  status,
  busy = false,
  onDetail,
  onInstall,
  onUninstall,
  onStart,
  onStop,
  onOpenLogs,
}: ComponentCardProps) {
  // バッジ情報（variant とラベル）を取得する
  const badgeInfo = STATUS_BADGE_MAP[status.service_status] ?? STATUS_BADGE_MAP.unknown;
  // インストール済みかどうかを判定する
  const isInstalled = status.service_status !== 'not_installed';
  // 実行中かどうかを判定する
  const isRunning = status.service_status === 'running';
  // 表示名を取得する（未定義時はコンポーネント種別名をそのまま使う）
  const displayName = DISPLAY_NAMES[status.component] ?? status.component;
  // 説明文を取得する
  const description = DESCRIPTIONS[status.component] ?? '';

  // カードを描画する（左ボーダー色はステータスに応じて切り替える）
  return (
    <div className={[styles.card, getStatusClass(status.service_status)].filter(Boolean).join(' ')}>

      {/* ─── ヘッダー（コンポーネント名・説明・ステータスバッジ）─── */}
      <div className={styles.header}>
        {/* 左側: コンポーネント名（クリックで詳細ページへ遷移する）と説明 */}
        <div>
          {/* コンポーネント名の見出し（onDetail が指定された場合はボタンとして描画する）*/}
          {onDetail ? (
            <button className={styles.nameButton} onClick={onDetail}>
              {displayName}
            </button>
          ) : (
            <h2 className={styles.name}>{displayName}</h2>
          )}
          {/* コンポーネントの説明文 */}
          <p className={styles.desc}>{description}</p>
        </div>
        {/* 右側: サービス状態バッジ（ドット付き）*/}
        <Badge variant={badgeInfo.variant} dot>
          {badgeInfo.label}
        </Badge>
      </div>

      {/* ─── 詳細情報（サービス名・エンドポイント・データ）─── */}
      <div className={styles.details}>
        {/* サービス名の行 */}
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>サービス名</span>
          <span className={styles.detailMono}>{status.service_name}</span>
        </div>

        {/* エンドポイントの行 */}
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>エンドポイント</span>
          {/* 到達可能状態を塗りつぶしドットで示す（CSS で 6px の丸を描画する）*/}
          <span
            className={
              status.endpoint_reachable
                // 到達可能なら成功色のドット
                ? styles.endpointReachable
                // 到達不可なら補助テキスト色のドット
                : styles.endpointUnreachable
            }
          />
          {/* エンドポイント URL */}
          <span className={styles.detailMono}>{status.endpoint_url}</span>
        </div>

        {/* データディレクトリの行 */}
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>データ</span>
          {/* 存在するかどうかをテキストで表示する */}
          <span>{status.data_dir_exists ? '存在する' : '未作成'}</span>
        </div>
      </div>

      {/* ─── アクションボタン群 ─── */}
      <div className={styles.actions}>
        {/* 開くボタン（実行中のみ有効、busy 中は無効）*/}
        <Button variant="primary" size="sm" onClick={() => openInBrowser(status.web_url)} disabled={!isRunning || busy}>
          <Icon icon={ExternalLink} size={14} />
          開く
        </Button>

        {/* インストールボタン（未インストール時のみ有効、busy 中は無効）*/}
        <Button variant="primary" size="sm" onClick={onInstall} disabled={isInstalled || busy}>
          <Icon icon={Download} size={14} />
          インストール
        </Button>

        {/* 削除ボタン（インストール済み時のみ有効、busy 中は無効）*/}
        <Button variant="danger" size="sm" onClick={onUninstall} disabled={!isInstalled || busy}>
          <Icon icon={Trash2} size={14} />
          削除
        </Button>

        {/* 開始ボタン（インストール済みかつ停止中のみ有効、busy 中は無効）*/}
        <Button variant="secondary" size="sm" onClick={onStart} disabled={!isInstalled || isRunning || busy}>
          <Icon icon={Play} size={14} />
          開始
        </Button>

        {/* 停止ボタン（実行中のみ有効、busy 中は無効）*/}
        <Button variant="secondary" size="sm" onClick={onStop} disabled={!isRunning || busy}>
          <Icon icon={Square} size={14} />
          停止
        </Button>

        {/* ログを開くボタン（busy 中は無効）*/}
        <Button variant="ghost" size="sm" onClick={onOpenLogs} disabled={busy}>
          <Icon icon={FileText} size={14} />
          ログ
        </Button>
      </div>
    </div>
  );
}
