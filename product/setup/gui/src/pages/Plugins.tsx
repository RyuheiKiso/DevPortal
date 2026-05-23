// Backstage プラグイン管理ページコンポーネント
// インストール済みプラグインの一覧・npm レジストリ検索・インストール・削除を提供する

// React のフックをインポートする
import { useState, useEffect, useCallback, useRef } from 'react';
// API ラッパー関数をインポートする
import { statusAll, pluginList, pluginSearch, pluginInstall, pluginRemove } from '../api/tauri';
// 型定義をインポートする
import type {
  SetupEvent,
  InstalledPlugin,
  PluginCandidate,
  PluginKind,
} from '../api/types';
// ステップ状態フックをインポートする
import { useStepState } from '../features/stepper/useStepState';
// ステッパー UI をインポートする
import { Stepper } from '../features/stepper/Stepper';
// 生ログ表示をインポートする
import { RawLog } from '../features/log/RawLog';
// UI プリミティブをインポートする
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { BadgeVariant } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Banner } from '../ui/Banner';
import { useToast } from '../ui/ToastProvider';
// ページで使用する lucide-react アイコンをインポートする
import {
  // プラグインページのメインアイコン
  Puzzle,
  // リロードボタンのアイコン
  RefreshCw,
  // インストールボタンのアイコン
  Download,
  // 削除ボタンのアイコン
  Trash2,
  // 検索アイコン
  Search,
  // 外部リンクアイコン
  ExternalLink,
} from 'lucide-react';
// CSS Modules のスタイルをインポートする
import styles from './Plugins.module.css';

// PluginKind の表示文字列マップ
const KIND_LABELS: Record<PluginKind, string> = {
  // フロントエンドプラグインの表示ラベル
  frontend: 'Frontend',
  // バックエンドプラグインの表示ラベル
  backend: 'Backend',
};

// PluginKind の Badge バリアントマップ
const KIND_BADGE_VARIANTS: Record<PluginKind, BadgeVariant> = {
  // フロントエンドプラグインは info バッジを使用する
  frontend: 'info',
  // バックエンドプラグインは warning バッジを使用する
  backend: 'warning',
};

// 検索クエリの debounce 遅延ミリ秒（入力を止めてから検索を実行する）
const SEARCH_DEBOUNCE_MS = 300;

// Plugins ページコンポーネント
export function Plugins() {
  // インストール済みプラグインのリスト（null = 読み込み中）
  const [installed, setInstalled] = useState<InstalledPlugin[] | null>(null);
  // npm レジストリ検索結果のリスト
  const [candidates, setCandidates] = useState<PluginCandidate[]>([]);
  // 検索ボックスの入力値
  const [searchQuery, setSearchQuery] = useState('');
  // 検索中フラグ
  const [searching, setSearching] = useState(false);
  // 受信したセットアップイベントの配列（Stepper / RawLog に渡す）
  const [events, setEvents] = useState<SetupEvent[]>([]);
  // 実行中フラグ（インストール・削除）
  const [running, setRunning] = useState(false);
  // 実行中の操作の説明（"Installing ..." / "Removing ..."）
  const [runningLabel, setRunningLabel] = useState('');
  // Backstage がインストールされているか（null = チェック前）
  const [backstageInstalled, setBackstageInstalled] = useState<boolean | null>(null);
  // 操作エラーメッセージ（null = エラーなし）
  const [error, setError] = useState<string | null>(null);
  // debounce タイマーの ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // useStepState フックで SetupEvent 配列をステップ状態に変換する
  const stepState = useStepState(events);

  // トーストフックを取得する
  const { showDanger } = useToast();

  // Backstage のインストール状態を確認してインストール済みプラグインを読み込む
  const loadData = useCallback(async () => {
    // エラーをリセットする
    setError(null);
    try {
      // 全コンポーネントのステータスを取得する
      const statuses = await statusAll();
      // Backstage のステータスを検索する
      const backstage = statuses.find((s) => s.component === 'backstage');
      // Backstage のデータディレクトリが存在するか確認する
      const isInstalled = backstage?.data_dir_exists ?? false;
      // Backstage インストール状態を更新する
      setBackstageInstalled(isInstalled);

      // Backstage がインストールされている場合のみプラグイン一覧を取得する
      if (isInstalled) {
        // インストール済みプラグインの一覧を取得する
        const plugins = await pluginList();
        // プラグインリストを更新する
        setInstalled(plugins);
      } else {
        // 未インストールの場合は空リストを設定する
        setInstalled([]);
      }
    } catch (e) {
      // エラーメッセージを表示する
      setError(String(e));
    }
  }, []);

  // マウント時にデータを読み込む
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 検索クエリが変わったら debounce して検索を実行する
  useEffect(() => {
    // 既存のタイマーをクリアする
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    // クエリが空の場合は検索結果をクリアして終了する
    if (!searchQuery.trim()) {
      setCandidates([]);
      return;
    }
    // SEARCH_DEBOUNCE_MS ミリ秒後に検索を実行する
    debounceRef.current = setTimeout(async () => {
      // 検索中フラグを立てる
      setSearching(true);
      try {
        // npm レジストリでプラグインを検索する
        const results = await pluginSearch(searchQuery);
        // 検索結果を更新する
        setCandidates(results);
      } catch (e) {
        // 検索エラーをトーストで表示する
        showDanger('検索エラー: ' + String(e));
      } finally {
        // 検索中フラグを解除する
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, [searchQuery, showDanger]);

  // プラグインをインストールする処理
  const handleInstall = useCallback(async (candidate: PluginCandidate) => {
    // 既に実行中の場合は何もしない
    if (running) return;
    // イベント配列をリセットする
    setEvents([]);
    // 実行中フラグを立てる
    setRunning(true);
    // 実行中の操作ラベルを設定する
    setRunningLabel(`Installing ${candidate.name}...`);
    // エラーをリセットする
    setError(null);
    try {
      // プラグインインストールを実行する
      await pluginInstall(
        // インストール要求を作成する
        { package_name: candidate.name, kind: candidate.kind },
        // 進捗イベントをイベント配列に追加するコールバック
        (ev) => setEvents((prev) => [...prev, ev]),
      );
      // 完了後にプラグイン一覧を再読み込みする
      const plugins = await pluginList();
      setInstalled(plugins);
    } catch (e) {
      // インストールエラーをエラー状態に設定する
      setError(String(e));
    } finally {
      // 実行中フラグを解除する
      setRunning(false);
    }
  }, [running]);

  // プラグインを削除する処理
  const handleRemove = useCallback(async (plugin: InstalledPlugin) => {
    // 既に実行中の場合は何もしない
    if (running) return;
    // イベント配列をリセットする
    setEvents([]);
    // 実行中フラグを立てる
    setRunning(true);
    // 実行中の操作ラベルを設定する
    setRunningLabel(`Removing ${plugin.name}...`);
    // エラーをリセットする
    setError(null);
    try {
      // プラグイン削除を実行する
      await pluginRemove(
        // 削除要求を作成する
        { package_name: plugin.name, kind: plugin.kind },
        // 進捗イベントをイベント配列に追加するコールバック
        (ev) => setEvents((prev) => [...prev, ev]),
      );
      // 完了後にプラグイン一覧を再読み込みする
      const plugins = await pluginList();
      setInstalled(plugins);
    } catch (e) {
      // 削除エラーをエラー状態に設定する
      setError(String(e));
    } finally {
      // 実行中フラグを解除する
      setRunning(false);
    }
  }, [running]);

  // Backstage が未インストールの場合は案内を表示する
  if (backstageInstalled === false) {
    return (
      <div className={styles.page}>
        {/* ページヘッダー */}
        <div className={styles.pageHeader}>
          {/* タイトルアイコン */}
          <Icon icon={Puzzle} size={20} color="var(--accent)" />
          {/* タイトルテキスト */}
          <div className={styles.titleGroup}>
            <h1 className={styles.pageTitle}>Backstage Plugins</h1>
            <p className={styles.pageDesc}>Backstage プラグインを管理します</p>
          </div>
        </div>
        {/* Backstage 未インストール案内バナー */}
        <Banner variant="warning">
          Backstage がインストールされていません。先に Backstage をインストールしてください。
        </Banner>
      </div>
    );
  }

  // ページ本体を描画する
  return (
    <div className={styles.page}>
      {/* ページヘッダー（タイトル + 再読み込みボタン） */}
      <div className={styles.pageHeader}>
        {/* タイトルアイコン */}
        <Icon icon={Puzzle} size={20} color="var(--accent)" />
        {/* タイトルとサブタイトル */}
        <div className={styles.titleGroup}>
          <h1 className={styles.pageTitle}>Backstage Plugins</h1>
          <p className={styles.pageDesc}>Backstage プラグインを管理します</p>
        </div>
        {/* 再読み込みボタン */}
        <Button
          variant="ghost"
          size="sm"
          onClick={loadData}
          disabled={running}
          aria-label="プラグイン一覧を再読み込み"
        >
          <Icon icon={RefreshCw} size={14} />
        </Button>
      </div>

      {/* エラーバナー */}
      {error && (
        <Banner variant="danger">{error}</Banner>
      )}

      {/* INSTALLED PLUGINS セクション */}
      <div className={styles.section}>
        {/* セクションヘッダー */}
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Installed Plugins</span>
          {/* インストール済み件数バッジ */}
          {installed !== null && (
            <Badge variant="neutral">{installed.length} 件</Badge>
          )}
        </div>

        {/* 読み込み中の場合はスケルトンを表示する */}
        {installed === null ? (
          <div className={styles.pluginList}>
            {/* スケルトンプレースホルダーを 3 件表示する */}
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.pluginRow}>
                <div style={{ flex: 1, height: 20, background: 'var(--surface-raised)', borderRadius: 4 }} />
              </div>
            ))}
          </div>
        ) : installed.length === 0 ? (
          // インストール済みプラグインがない場合のメッセージ
          <p className={styles.emptyMessage}>
            インストール済みのプラグインはありません。下の検索欄から追加してください。
          </p>
        ) : (
          // インストール済みプラグインのリストを表示する
          <div className={styles.pluginList}>
            {installed.map((plugin) => (
              <div key={plugin.name} className={styles.pluginRow}>
                {/* プラグイン名 */}
                <span className={styles.pluginName}>{plugin.name}</span>
                {/* バージョン */}
                <span className={styles.pluginVersion}>{plugin.version}</span>
                {/* 種別バッジ */}
                <Badge variant={KIND_BADGE_VARIANTS[plugin.kind]}>
                  {KIND_LABELS[plugin.kind]}
                </Badge>
                {/* 削除ボタン */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(plugin)}
                  disabled={running}
                  aria-label={`${plugin.name} を削除`}
                >
                  <Icon icon={Trash2} size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BROWSE / SEARCH セクション */}
      <div className={styles.section}>
        {/* セクションヘッダー */}
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Browse / Search</span>
        </div>

        {/* 検索ボックス */}
        <div className={styles.searchRow}>
          {/* 検索アイコン */}
          <Icon icon={Search} size={16} color="var(--text-muted)" />
          {/* 検索テキストボックス */}
          <input
            className={styles.searchInput}
            type="text"
            placeholder="プラグイン名を入力（例: kubernetes, techdocs）"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={running}
          />
          {/* 検索中スピナー */}
          {searching && (
            <span className={styles.searchSpinner}>検索中...</span>
          )}
        </div>

        {/* 検索結果のカードリスト */}
        {candidates.length > 0 && (
          <div className={styles.candidateList}>
            {candidates.map((candidate) => (
              <div key={candidate.name} className={styles.candidateCard}>
                {/* カードヘッダー（名前 + 種別バッジ） */}
                <div className={styles.candidateHeader}>
                  <span className={styles.candidateName}>{candidate.name}</span>
                  <Badge variant={KIND_BADGE_VARIANTS[candidate.kind]}>
                    {KIND_LABELS[candidate.kind]}
                  </Badge>
                  {/* バージョン表示 */}
                  <span className={styles.candidateVersion}>v{candidate.version}</span>
                </div>
                {/* 説明文 */}
                {candidate.description && (
                  <p className={styles.candidateDesc}>{candidate.description}</p>
                )}
                {/* アクション行（リポジトリリンク + インストールボタン） */}
                <div className={styles.candidateActions}>
                  {/* リポジトリ URL が存在する場合はリンクを表示する */}
                  {candidate.repository_url && (
                    <a
                      href={candidate.repository_url}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.repoLink}
                    >
                      <Icon icon={ExternalLink} size={14} />
                      Repository
                    </a>
                  )}
                  {/* インストールボタン */}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleInstall(candidate)}
                    disabled={running}
                  >
                    <Icon icon={Download} size={14} />
                    Install
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* クエリが入力済みで結果なし・検索完了の場合はメッセージを表示する */}
        {searchQuery.trim() && !searching && candidates.length === 0 && (
          <p className={styles.emptyMessage}>
            "{searchQuery}" に一致するプラグインが見つかりませんでした。
          </p>
        )}
      </div>

      {/* PROGRESS セクション（実行中またはイベントがある場合に表示する） */}
      {(running || events.length > 0) && (
        <div className={styles.section}>
          {/* セクションヘッダー */}
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>
              {running ? runningLabel : 'Progress'}
            </span>
          </div>
          {/* ステッパー UI（進捗ステップを表示する） */}
          <Stepper state={stepState} />
          {/* 生ログ（詳細ログを折りたたみ表示する） */}
          {events.length > 0 && <RawLog events={events} />}
        </div>
      )}
    </div>
  );
}
