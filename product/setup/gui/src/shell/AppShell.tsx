// アプリのシェルコンポーネント（トップバー・サイドバー・メインコンテンツを Grid で配置する）
// ルーターから現在のルートを読んでメインエリアに適切なページを表示する

// useRef・useState・useCallback・useMemo フックをインポートする
import { useRef, useState, useCallback, useMemo } from 'react';
// CSS Modules のスタイルをインポートする
import styles from './AppShell.module.css';
// トップバーコンポーネントをインポートする
import { TopBar } from './TopBar';
// サイドバーコンポーネントをインポートする
import { Sidebar } from './Sidebar';
// ルーター（現在のルートと navigate 関数）をインポートする
import { useRouter } from '../router/router';
// 各ページコンポーネントをインポートする
import { Overview } from '../pages/Overview';
import { Install } from '../pages/Install';
import { Uninstall } from '../pages/Uninstall';
// 設定ページをインポートする
import { Settings } from '../pages/Settings';
// コンポーネント詳細ページをインポートする
import { ComponentDetail } from '../pages/ComponentDetail';
// TopBar と Overview の間でアクション関数を共有するコンテキストをインポートする
import { AppActionsContext } from './AppActionsContext';

// 現在のルートに応じたページコンポーネントを描画するアウトレットコンポーネント
function RouteOutlet() {
  // 現在のルートと遷移関数を取得する
  const { route, navigate } = useRouter();

  // ルートの page に応じて描画するページコンポーネントを切り替える
  switch (route.page) {
    // Overview（ダッシュボード）ページ
    case 'overview':
      return (
        <Overview
          // インストール画面へ遷移するコールバックを渡す
          onGoInstall={(component) => navigate({ page: 'install', component })}
          // アンインストール画面へ遷移するコールバックを渡す
          onGoUninstall={(component) => navigate({ page: 'uninstall', component })}
          // 詳細画面へ遷移するコールバックを渡す
          onGoDetail={(component) => navigate({ page: 'detail', component })}
        />
      );

    // インストール実行ページ
    case 'install':
      return (
        <Install
          // インストールするコンポーネント種別を渡す
          component={route.component}
          // 戻るボタンで Overview に遷移するコールバックを渡す
          onBack={() => navigate({ page: 'overview' })}
        />
      );

    // アンインストール実行ページ
    case 'uninstall':
      return (
        <Uninstall
          // アンインストールするコンポーネント種別を渡す
          component={route.component}
          // 戻るボタンで Overview に遷移するコールバックを渡す
          onBack={() => navigate({ page: 'overview' })}
        />
      );

    // 設定ページ
    case 'settings':
      // Settings は onBack コールバックを受け取らず自前のナビゲーションガードを使う
      return <Settings />;

    // コンポーネント詳細ページ（Verdaccio / Backstage の状態・操作・設定を一覧表示する）
    case 'detail':
      return (
        <ComponentDetail
          // 表示するコンポーネントの種別を渡す
          component={route.component}
          // インストール画面へ遷移するコールバックを渡す
          onGoInstall={() => navigate({ page: 'install', component: route.component })}
          // アンインストール画面へ遷移するコールバックを渡す
          onGoUninstall={() => navigate({ page: 'uninstall', component: route.component })}
          // Overview へ戻るコールバックを渡す
          onBack={() => navigate({ page: 'overview' })}
        />
      );
  }
}

// Grid レイアウトでトップバー・サイドバー・メインを組み合わせるシェルコンポーネント
export function AppShell() {
  // TopBar → Overview の実関数を格納する ref を生成する
  // 初期値はマウント前の no-op（Overview がマウント時に実際の関数を登録する）
  const loadStatusesRef = useRef<() => Promise<void>>(async () => {});
  // 前提チェック実関数への ref（Overview がマウント時に登録する）
  const prereqCheckRef = useRef<() => Promise<void>>(async () => {});
  // ステータス更新の実行中フラグ（TopBar・Overview で共有して二重発火を防ぐ）
  const [isRefreshing, setIsRefreshing] = useState(false);
  // 前提チェックの実行中フラグ（TopBar・Overview で共有して二重発火を防ぐ）
  const [isPrereqChecking, setIsPrereqChecking] = useState(false);

  // ローディング管理込みのステータス更新ラッパー（実行中なら早期 return して二重発火を防ぐ）
  const runLoadStatuses = useCallback(async () => {
    // 既に実行中の場合は重複実行しない
    if (isRefreshing) return;
    // 実行中フラグを立てる
    setIsRefreshing(true);
    try {
      // ref に登録された Overview の loadStatuses 実関数を呼び出す
      await loadStatusesRef.current();
    } finally {
      // 完了後（成功・失敗問わず）フラグを解除する
      setIsRefreshing(false);
    }
  }, [isRefreshing]);

  // ローディング管理込みの前提チェックラッパー（実行中なら早期 return して二重発火を防ぐ）
  const runPrereqCheck = useCallback(async () => {
    // 既に実行中の場合は重複実行しない
    if (isPrereqChecking) return;
    // 実行中フラグを立てる
    setIsPrereqChecking(true);
    try {
      // ref に登録された Overview の handlePrereqCheck 実関数を呼び出す
      await prereqCheckRef.current();
    } finally {
      // 完了後（成功・失敗問わず）フラグを解除する
      setIsPrereqChecking(false);
    }
  }, [isPrereqChecking]);

  // コンテキスト値を useMemo で安定化して不要な子再レンダリングを抑制する
  const actionsContextValue = useMemo(() => ({
    loadStatusesRef,
    prereqCheckRef,
    isRefreshing,
    isPrereqChecking,
    runLoadStatuses,
    runPrereqCheck,
  }), [isRefreshing, isPrereqChecking, runLoadStatuses, runPrereqCheck]);

  // シェルの構造: トップバー（全幅）+ サイドバー（240px）+ メイン（残り）
  return (
    // AppActionsContext でシェル全体を包み、TopBar と Overview がローディング状態を共有できるようにする
    <AppActionsContext.Provider value={actionsContextValue}>
      <div className={styles.shell}>
        {/* トップバー（グリッド 1 行目全幅） */}
        <div className={styles.topbar}>
          <TopBar />
        </div>

        {/* サイドバー（グリッド 2 行目 1 列目） */}
        <div className={styles.sidebar}>
          <Sidebar />
        </div>

        {/* メインコンテンツ（グリッド 2 行目 2 列目） */}
        <main className={styles.main}>
          {/* 現在のルートに応じたページを描画する */}
          <RouteOutlet />
        </main>
      </div>
    </AppActionsContext.Provider>
  );
}
