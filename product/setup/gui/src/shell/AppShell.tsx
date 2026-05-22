// アプリのシェルコンポーネント（トップバー・サイドバー・メインコンテンツを Grid で配置する）
// ルーターから現在のルートを読んでメインエリアに適切なページを表示する

// useRef フックをインポートする
import { useRef } from 'react';
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

    // コンポーネント詳細ページ（将来実装のため暫定的に Overview を表示する）
    case 'detail':
      return (
        <Overview
          onGoInstall={(component) => navigate({ page: 'install', component })}
          onGoUninstall={(component) => navigate({ page: 'uninstall', component })}
        />
      );
  }
}

// Grid レイアウトでトップバー・サイドバー・メインを組み合わせるシェルコンポーネント
export function AppShell() {
  // TopBar → Overview のアクション関数を格納する ref を生成する
  // 初期値はマウント前の no-op（Overview がマウント時に実際の関数を登録する）
  const loadStatusesRef = useRef<() => Promise<void>>(async () => {});
  // 前提チェック関数への ref（Overview がマウント時に登録する）
  const prereqCheckRef = useRef<() => Promise<void>>(async () => {});

  // シェルの構造: トップバー（全幅）+ サイドバー（240px）+ メイン（残り）
  return (
    // AppActionsContext でシェル全体を包み、TopBar と Overview が ref を共有できるようにする
    <AppActionsContext.Provider value={{ loadStatuses: loadStatusesRef, prereqCheck: prereqCheckRef }}>
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
