// アプリ上部の全幅固定バーコンポーネント（パンくずナビと右側アクションを提供する）
// 現在のルートに応じたパンくずとリフレッシュ・前提チェックボタンを表示する

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
    // 詳細画面
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
  // 共有コンテキストからローディング状態とラッパー関数を取得する
  const appActions = useAppActions();
  // 共有ローディング状態を取得する（TopBar・Overview 両方で同じ値を参照する）
  const isRefreshing = appActions?.isRefreshing ?? false;
  // 前提チェックのローディング状態を取得する
  const isPrereqChecking = appActions?.isPrereqChecking ?? false;

  // 現在のルートからパンくず配列を生成する
  const breadcrumbs = getBreadcrumbs(route);

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
          {/* 前提チェックボタン（AppActionsContext の runPrereqCheck を呼び出す）*/}
          <Button
            // ゴーストボタンとして表示する
            variant="ghost"
            // 小さいサイズ
            size="sm"
            // 共有ラッパー関数を呼び出す（二重発火防止は内部で行う）
            onClick={() => appActions?.runPrereqCheck()}
            // 共有ローディング状態でボタンを無効にする
            disabled={isPrereqChecking}
            // アクセシブルラベル
            aria-label="前提条件を再チェックする"
          >
            {/* 前提チェックアイコン */}
            <Icon icon={ShieldCheck} size={14} />
            {/* 実行中はラベルを変更する */}
            {isPrereqChecking ? '確認中…' : '前提チェック'}
          </Button>

          {/* ステータス更新ボタン（AppActionsContext の runLoadStatuses を呼び出す）*/}
          <Button
            // ゴーストボタンとして表示する
            variant="ghost"
            // 小さいサイズ
            size="sm"
            // 共有ラッパー関数を呼び出す（二重発火防止は内部で行う）
            onClick={() => appActions?.runLoadStatuses()}
            // 共有ローディング状態でボタンを無効にする
            disabled={isRefreshing}
            // アクセシブルラベル
            aria-label="ステータスを更新する"
          >
            {/* 更新アイコン */}
            <Icon icon={RefreshCw} size={14} />
            {/* 実行中はラベルを変更する */}
            {isRefreshing ? '更新中…' : '更新'}
          </Button>
        </div>
      )}
    </header>
  );
}
