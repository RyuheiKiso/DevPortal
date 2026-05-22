// コンポーネント一覧（Overview）ページコンポーネント
// 全コンポーネントのステータス・前提条件チェック結果を表示し、操作ボタンを提供する

// React のフックをインポートする（react-jsx transform を使用しているため React 自体は不要）
import { useState, useEffect, useCallback } from 'react';
// TopBar と関数を共有するためのコンテキストフックをインポートする
import { useAppActions } from '../shell/AppActionsContext';
// 型定義をインポートする
import type { ComponentStatus, ComponentKind, PrereqReport } from '../api/types';
// Tauri API ラッパーをインポートする
import { statusAll, prereqCheck, serviceAction, openLogs } from '../api/tauri';
// 新しい ComponentCard をインポートする
import { ComponentCard } from '../features/components/ComponentCard';
// UI プリミティブをインポートする
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { BadgeVariant } from '../ui/Badge';
import { Icon } from '../ui/Icon';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/ToastProvider';
// ページで使用する lucide-react アイコンをインポートする
import {
  // ステータス更新ボタンのアイコン
  RefreshCw,
  // 前提チェックボタンのアイコン
  ShieldCheck,
  // 折りたたみが開いているときのアイコン
  ChevronDown,
  // 折りたたみが閉じているときのアイコン
  ChevronRight,
  // 前提チェック成功アイコン
  CheckCircle2,
  // 前提チェック失敗アイコン
  XCircle,
} from 'lucide-react';
// CSS Modules のスタイルをインポートする
import styles from './Overview.module.css';

// Overview ページが受け取る Props 型（AppShell から渡される）
interface OverviewProps {
  // Install 画面へ遷移するコールバック（コンポーネント種別を渡す）
  onGoInstall: (component: ComponentKind) => void;
  // Uninstall 画面へ遷移するコールバック（コンポーネント種別を渡す）
  onGoUninstall: (component: ComponentKind) => void;
}

// PrereqReport の all_ok フラグに応じて Badge の variant を返すヘルパー関数
function prereqBadgeVariant(allOk: boolean): BadgeVariant {
  // 全て OK なら成功色、問題あれば危険色
  return allOk ? 'success' : 'danger';
}

// コンポーネント一覧と前提条件チェックを表示するページコンポーネント
export function Overview({ onGoInstall, onGoUninstall }: OverviewProps) {
  // コンポーネントのステータスリスト
  const [statuses, setStatuses] = useState<ComponentStatus[]>([]);
  // ステータス取得中のローディングフラグ
  const [loading, setLoading] = useState(false);
  // ステータス取得エラーメッセージ
  const [error, setError] = useState<string | null>(null);
  // 前提条件チェック結果
  const [prereqReport, setPrereqReport] = useState<PrereqReport | null>(null);
  // 前提条件チェック中のローディングフラグ
  const [prereqLoading, setPrereqLoading] = useState(false);
  // 前提条件セクションの展開/折りたたみ状態
  const [prereqOpen, setPrereqOpen] = useState(true);
  // トースト通知の関数を取得する
  const { showSuccess, showDanger } = useToast();
  // TopBar のボタンから呼び出せるよう関数を共有するコンテキストを取得する
  const appActions = useAppActions();

  // ステータスを取得するコールバック（初回マウント時と更新ボタン押下時に使用）
  const loadStatuses = useCallback(async () => {
    // ローディングフラグを立てる
    setLoading(true);
    // エラーをリセットする
    setError(null);
    try {
      // statusAll() で全コンポーネントのステータスを一括取得する
      const result = await statusAll();
      // 取得したステータスを state に反映する
      setStatuses(result);
    } catch (e) {
      // 取得失敗時はエラーメッセージを state にセットする
      setError(`ステータス取得失敗: ${String(e)}`);
    } finally {
      // ローディングフラグを解除する
      setLoading(false);
    }
  }, []);

  // 初回マウント時にステータスを取得する副作用
  useEffect(() => {
    // loadStatuses を呼び出してコンポーネントの状態を読み込む
    loadStatuses();
  }, [loadStatuses]);

  // 前提条件チェックを実行するコールバック
  const handlePrereqCheck = useCallback(async () => {
    // チェック開始時は必ず展開して結果を見えるようにする
    setPrereqOpen(true);
    // 前提条件チェック中フラグを立てる
    setPrereqLoading(true);
    // 以前の結果をリセットする
    setPrereqReport(null);
    try {
      // prereqCheck() で前提条件チェックを実行する
      const report = await prereqCheck();
      // チェック結果を state にセットする
      setPrereqReport(report);
    } catch (e) {
      // チェック失敗時はエラートーストを表示する
      showDanger(`前提条件チェック失敗: ${String(e)}`);
    } finally {
      // チェック中フラグを解除する
      setPrereqLoading(false);
    }
  }, [showDanger]);

  // Overview がマウントされたとき、TopBar から呼び出せるよう関数を ref に登録する
  // アンマウント時は no-op に戻して他のページ表示中に誤呼び出しされないようにする
  useEffect(() => {
    // appActions が利用可能な場合（AppActionsContext のスコープ内）のみ登録する
    if (!appActions) return;
    // loadStatuses を TopBar から呼び出せるよう ref に設定する
    appActions.loadStatuses.current = loadStatuses;
    // handlePrereqCheck を TopBar から呼び出せるよう ref に設定する
    appActions.prereqCheck.current = handlePrereqCheck;
    // アンマウント時（他のページに遷移したとき）は no-op に戻す
    return () => {
      // no-op の async 関数を設定することで誤呼び出しを防ぐ
      appActions.loadStatuses.current = async () => {};
      appActions.prereqCheck.current = async () => {};
    };
  }, [appActions, loadStatuses, handlePrereqCheck]);

  // サービスを開始するコールバック
  const handleStart = useCallback(async (component: ComponentKind) => {
    try {
      // serviceAction で start アクションを実行する
      await serviceAction(component, 'start');
      // 成功トーストを表示する
      showSuccess(`${component} を開始しました`);
      // ステータスを再取得して画面を更新する
      await loadStatuses();
    } catch (e) {
      // 失敗時はエラートーストを表示する
      showDanger(`開始失敗: ${String(e)}`);
    }
  }, [loadStatuses, showSuccess, showDanger]);

  // サービスを停止するコールバック
  const handleStop = useCallback(async (component: ComponentKind) => {
    try {
      // serviceAction で stop アクションを実行する
      await serviceAction(component, 'stop');
      // 成功トーストを表示する
      showSuccess(`${component} を停止しました`);
      // ステータスを再取得して画面を更新する
      await loadStatuses();
    } catch (e) {
      // 失敗時はエラートーストを表示する
      showDanger(`停止失敗: ${String(e)}`);
    }
  }, [loadStatuses, showSuccess, showDanger]);

  // ログフォルダを開くコールバック
  const handleOpenLogs = useCallback(async (component: ComponentKind) => {
    try {
      // openLogs でエクスプローラーにログフォルダを開かせる
      await openLogs(component);
    } catch (e) {
      // 失敗時はエラートーストを表示する
      showDanger(`ログを開けませんでした: ${String(e)}`);
    }
  }, [showDanger]);

  // Overview ページを描画する
  return (
    <div className={styles.page}>

      {/* ─── ページヘッダー（タイトル + 操作ボタン）─── */}
      <div className={styles.pageHeader}>
        {/* 左側: ページタイトルと説明文 */}
        <div>
          <h1 className={styles.pageTitle}>Overview</h1>
          <p className={styles.pageDesc}>コンポーネントの状態を確認・操作します</p>
        </div>
        {/* 右側: 操作ボタン群 */}
        <div className={styles.headerActions}>
          {/* 前提チェックボタン */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrereqCheck}
            disabled={prereqLoading}
          >
            <Icon icon={ShieldCheck} size={14} />
            {prereqLoading ? '確認中…' : '前提チェック'}
          </Button>
          {/* ステータス更新ボタン */}
          <Button
            variant="secondary"
            size="sm"
            onClick={loadStatuses}
            disabled={loading}
          >
            <Icon icon={RefreshCw} size={14} />
            {loading ? '更新中…' : '更新'}
          </Button>
        </div>
      </div>

      {/* ─── エラーバナー（ステータス取得失敗時に表示）─── */}
      {error && (
        <Banner variant="danger" className={styles.banner}>
          {error}
        </Banner>
      )}

      {/* ─── 前提条件チェックセクション（チェック実行後に表示）─── */}
      {(prereqReport !== null || prereqLoading) && (
        <section className={styles.section}>
          {/* セクションヘッダー（クリックで折りたたみ切り替え）*/}
          <button
            className={styles.sectionToggle}
            onClick={() => setPrereqOpen(o => !o)}
            // アクセシブルなラベルを付与する
            aria-expanded={prereqOpen}
          >
            {/* 折りたたみ状態に応じてアイコンを切り替える */}
            <Icon icon={prereqOpen ? ChevronDown : ChevronRight} size={14} />
            {/* セクションの CAPS ラベル */}
            <span className={styles.sectionLabel}>PREREQUISITES</span>
            {/* チェック結果バッジ（結果が出ている場合のみ表示）*/}
            {prereqReport && (
              <Badge variant={prereqBadgeVariant(prereqReport.all_ok)} dot>
                {prereqReport.all_ok ? 'すべて OK' : '問題あり'}
              </Badge>
            )}
            {/* チェック件数カウント */}
            {prereqReport && (
              <span className={styles.prereqCount}>
                {prereqReport.items.filter(i => i.found).length} / {prereqReport.items.length} OK
              </span>
            )}
          </button>

          {/* 展開時のみテーブルを表示する */}
          {prereqOpen && prereqReport && (
            <table className={styles.prereqTable}>
              <thead>
                <tr>
                  {/* 状態列ヘッダー */}
                  <th className={styles.th}>状態</th>
                  {/* コマンド列ヘッダー */}
                  <th className={styles.th}>コマンド</th>
                  {/* バージョン/案内列ヘッダー */}
                  <th className={styles.th}>バージョン / 案内</th>
                </tr>
              </thead>
              <tbody>
                {/* 各前提コマンドのチェック結果を 1 行ずつ表示する */}
                {prereqReport.items.map((item) => (
                  <tr key={item.name} className={styles.tr}>
                    {/* 状態アイコン（成功/失敗）の列 */}
                    <td className={styles.td}>
                      <Icon
                        // 成功なら緑チェック、失敗なら赤バツアイコン
                        icon={item.found ? CheckCircle2 : XCircle}
                        size={14}
                        // 成功なら成功色、失敗なら危険色
                        color={item.found ? 'var(--success)' : 'var(--danger)'}
                      />
                    </td>
                    {/* コマンド名の列（等幅フォント）*/}
                    <td className={[styles.td, styles.mono].join(' ')}>{item.name}</td>
                    {/* バージョン（成功時）またはインストール案内（失敗時）の列 */}
                    <td
                      className={styles.td}
                      // 失敗時は危険色でインストール案内を表示する
                      style={{ color: item.found ? 'var(--text-muted)' : 'var(--danger)' }}
                    >
                      {item.found
                        // バージョン文字列（取得できない場合は「—」）
                        ? (item.version ?? '—')
                        // インストール案内テキスト
                        : item.install_hint
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ─── コンポーネントセクション ─── */}
      <section className={styles.section}>
        {/* セクションヘッダー */}
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>COMPONENTS</span>
        </div>

        {/* ローディング中かつステータスが空の場合はスケルトンを表示する */}
        {loading && statuses.length === 0 && (
          <div className={styles.componentGrid}>
            <Skeleton height={200} />
            <Skeleton height={200} />
          </div>
        )}

        {/* ステータスが空でローディングもエラーもない場合の空状態メッセージ */}
        {!loading && statuses.length === 0 && !error && (
          <p className={styles.empty}>コンポーネントが見つかりません</p>
        )}

        {/* コンポーネントカードのグリッドを描画する */}
        {statuses.length > 0 && (
          <div className={styles.componentGrid}>
            {/* 各コンポーネントのカードを描画する */}
            {statuses.map((s) => (
              <ComponentCard
                // コンポーネント種別をキーに使用する
                key={s.component}
                // ステータス情報を渡す
                status={s}
                // インストールボタンのコールバックを渡す
                onInstall={() => onGoInstall(s.component)}
                // アンインストールボタンのコールバックを渡す
                onUninstall={() => onGoUninstall(s.component)}
                // 開始ボタンのコールバックを渡す
                onStart={() => handleStart(s.component)}
                // 停止ボタンのコールバックを渡す
                onStop={() => handleStop(s.component)}
                // ログを開くボタンのコールバックを渡す
                onOpenLogs={() => handleOpenLogs(s.component)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
