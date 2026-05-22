// アプリ上部の全幅固定バーコンポーネント（パンくずナビと右側アクションを提供する）
// 現在のルートに応じたパンくずとリフレッシュ・前提チェックボタンを表示する

// useState フックをインポートする
import { useState } from 'react';
// CSS Modules のスタイルをインポートする
import styles from './TopBar.module.css';
// ルーター（現在のルートと navigate 関数）をインポートする
import { useRouter } from '../router/router';
// Route の型をインポートする
import type { Route } from '../router/router';
// TopBar と Overview の間でアクション関数を共有するコンテキストフックをインポートする
import { useAppActions } from './AppActionsContext';
// ボタンコンポーネントをインポートする
import { Button } from '../ui/Button';
// アイコンコンポーネントをインポートする
import { Icon } from '../ui/Icon';
// 使用する lucide-react アイコンをインポートする
import { RefreshCw, ShieldCheck } from 'lucide-react';

// ルートからパンくずの表示テキスト配列を生成する関数
function getBreadcrumbs(route: Route): string[] {
  // ルートの page に応じてパンくずを構築する
  switch (route.page) {
    // Overview は最上位なので 1 要素のみ
    case 'overview':
      return ['Overview'];
    // インストール画面はコンポーネント名 + 操作名
    case 'install':
      return [
        // コンポーネント名（先頭大文字）
        route.component.charAt(0).toUpperCase() + route.component.slice(1),
        // 操作名
        'Install',
      ];
    // アンインストール画面はコンポーネント名 + 操作名
    case 'uninstall':
      return [
        // コンポーネント名（先頭大文字）
        route.component.charAt(0).toUpperCase() + route.component.slice(1),
        // 操作名
        'Uninstall',
      ];
    // 設定画面
    case 'settings':
      return ['Settings'];
    // 詳細画面（将来用）
    case 'detail':
      return [
        // コンポーネント名（先頭大文字）
        route.component.charAt(0).toUpperCase() + route.component.slice(1),
      ];
    // デフォルトは Overview にフォールバックする
    default:
      return ['Overview'];
  }
}

// トップバーコンポーネント
export function TopBar() {
  // 現在のルートを取得する
  const { route } = useRouter();
  // Overview の関数を共有するコンテキストを取得する
  const appActions = useAppActions();
  // 更新ボタンのローディング状態
  const [refreshing, setRefreshing] = useState(false);
  // 前提チェックボタンのローディング状態
  const [prereqing, setPrereqing] = useState(false);

  // 現在のルートからパンくず配列を生成する
  const breadcrumbs = getBreadcrumbs(route);

  // ステータス更新ボタンのクリックハンドラ
  // Overview の loadStatuses を呼び出してコンポーネントの状態を再取得する
  const handleRefresh = async () => {
    // 既に更新中の場合は重複実行しない
    if (refreshing) return;
    // 更新中フラグを立てる
    setRefreshing(true);
    try {
      // AppActionsContext 経由で Overview の loadStatuses を呼び出す
      await appActions?.loadStatuses.current();
    } finally {
      // 更新中フラグを解除する
      setRefreshing(false);
    }
  };

  // 前提チェックボタンのクリックハンドラ
  // Overview の handlePrereqCheck を呼び出して前提条件を確認する
  const handlePrereqCheck = async () => {
    // 既にチェック中の場合は重複実行しない
    if (prereqing) return;
    // チェック中フラグを立てる
    setPrereqing(true);
    try {
      // AppActionsContext 経由で Overview の handlePrereqCheck を呼び出す
      await appActions?.prereqCheck.current();
    } finally {
      // チェック中フラグを解除する
      setPrereqing(false);
    }
  };

  // Overview ページ以外ではアクションボタンを非表示にする
  // （更新・前提チェックは Overview のコンテキストでのみ意味を持つ）
  const showActions = route.page === 'overview';

  // トップバーを描画する
  return (
    <header className={styles.topbar}>
      {/* 左側: パンくずナビゲーション */}
      <div className={styles.left}>
        {/* パンくず配列を順番に描画する */}
        {breadcrumbs.map((crumb, index) => {
          // 最後のアイテムかどうかを判定する
          const isLast = index === breadcrumbs.length - 1;

          return (
            // React のリストレンダリングのため key を付与する
            <span key={crumb} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {/* 先頭以外のアイテムの前にセパレータ "/" を表示する */}
              {index > 0 && <span className={styles.separator}>/</span>}
              {/* 最後のアイテムは現在ページのスタイル、それ以外は通常スタイル */}
              <span className={isLast ? styles.breadcrumbCurrent : styles.breadcrumb}>
                {crumb}
              </span>
            </span>
          );
        })}
      </div>

      {/* 右側: アクションボタン群（Overview ページのみ表示する）*/}
      {showActions && (
        <div className={styles.right}>
          {/* 前提チェックボタン */}
          <Button
            // ゴーストボタンとして表示する
            variant="ghost"
            // 小さいサイズ
            size="sm"
            // Overview の handlePrereqCheck を呼び出す
            onClick={handlePrereqCheck}
            // チェック中は無効にする
            disabled={prereqing}
            // アクセシブルラベル
            aria-label="前提条件を再チェックする"
          >
            {/* 前提チェックアイコン */}
            <Icon icon={ShieldCheck} size={14} />
            {/* 実行中はラベルを変更する */}
            {prereqing ? '確認中…' : '前提チェック'}
          </Button>

          {/* ステータス更新ボタン */}
          <Button
            // ゴーストボタンとして表示する
            variant="ghost"
            // 小さいサイズ
            size="sm"
            // Overview の loadStatuses を呼び出す
            onClick={handleRefresh}
            // 更新中は無効にする
            disabled={refreshing}
            // アクセシブルラベル
            aria-label="ステータスを更新する"
          >
            {/* 更新アイコン */}
            <Icon icon={RefreshCw} size={14} />
            {/* 実行中はラベルを変更する */}
            {refreshing ? '更新中…' : '更新'}
          </Button>
        </div>
      )}
    </header>
  );
}
