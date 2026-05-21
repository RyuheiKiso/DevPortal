// このファイルはアプリのルートコンポーネントを定義する
// useState でページ状態を管理し Dashboard / Install / Uninstall を切り替える
// また起動時のスプラッシュ画面表示を useEffect で制御する

// React と useState / useEffect フックをインポートする
import { useState, useEffect } from 'react';

// ページコンポーネントをインポートする
import { Dashboard } from './pages/Dashboard';
import { Install } from './pages/Install';
import { Uninstall } from './pages/Uninstall';

// スプラッシュ画面コンポーネントをインポートする
import { Splash } from './components/Splash';

// 型定義をインポートする
import type { ComponentKind } from './api/types';

// ページ状態の型定義
// 'dashboard' はダッシュボード画面を示す
// { page: 'install' | 'uninstall'; component: ComponentKind } はインストール/アンインストール画面を示す
type PageState =
  | 'dashboard'
  | { page: 'install'; component: ComponentKind }
  | { page: 'uninstall'; component: ComponentKind };

// App: アプリのルートコンポーネント（ページ切り替えとスプラッシュを管理する）
function App() {
  // 現在表示するページを管理する state（初期値はダッシュボード）
  const [pageState, setPageState] = useState<PageState>('dashboard');

  // スプラッシュ画面を表示するかどうかを管理する state（初期値: 表示）
  const [showSplash, setShowSplash] = useState(true);
  // スプラッシュのフェードアウトを開始するかどうかを管理する state
  const [splashFadingOut, setSplashFadingOut] = useState(false);

  // 起動直後に 1.2 秒後にフェードアウト開始、1.5 秒後にスプラッシュを非表示にする
  useEffect(() => {
    // 1200ms 後にフェードアウトを開始する
    const fadeTimer = setTimeout(() => {
      // フェードアウトアニメーションを開始する
      setSplashFadingOut(true);
    }, 1200);

    // 1500ms 後にスプラッシュを完全に非表示にする（フェードアウト完了後）
    const removeTimer = setTimeout(() => {
      // スプラッシュの DOM レンダリングを停止する
      setShowSplash(false);
    }, 1500);

    // クリーンアップ：コンポーネントがアンマウントされた場合はタイマーをキャンセルする
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  // ダッシュボードに戻る関数
  const goToDashboard = () => {
    // ページ状態をダッシュボードにリセットする
    setPageState('dashboard');
  };

  // インストール画面に遷移する関数
  const goToInstall = (component: ComponentKind) => {
    // ページ状態をインストール画面にセットする
    setPageState({ page: 'install', component });
  };

  // アンインストール画面に遷移する関数
  const goToUninstall = (component: ComponentKind) => {
    // ページ状態をアンインストール画面にセットする
    setPageState({ page: 'uninstall', component });
  };

  // 現在のページコンテンツをレンダリングする関数
  const renderPage = () => {
    // ページ状態に応じて表示するコンポーネントを切り替える
    if (pageState === 'dashboard') {
      // ダッシュボード画面を表示する
      return (
        <Dashboard
          // インストール画面への遷移コールバックを渡す
          onGoInstall={goToInstall}
          // アンインストール画面への遷移コールバックを渡す
          onGoUninstall={goToUninstall}
        />
      );
    }

    // pageState がオブジェクトでかつ page が 'install' の場合はインストール画面を表示する
    if (typeof pageState === 'object' && pageState.page === 'install') {
      return (
        <Install
          // インストールするコンポーネント種別を渡す
          component={pageState.component}
          // ダッシュボードへ戻るコールバックを渡す
          onBack={goToDashboard}
        />
      );
    }

    // pageState がオブジェクトでかつ page が 'uninstall' の場合はアンインストール画面を表示する
    if (typeof pageState === 'object' && pageState.page === 'uninstall') {
      return (
        <Uninstall
          // アンインストールするコンポーネント種別を渡す
          component={pageState.component}
          // ダッシュボードへ戻るコールバックを渡す
          onBack={goToDashboard}
        />
      );
    }

    // 想定外の状態の場合はダッシュボードにフォールバックする
    return (
      <Dashboard
        onGoInstall={goToInstall}
        onGoUninstall={goToUninstall}
      />
    );
  };

  return (
    // ルートコンテナ（スプラッシュとページコンテンツを重ねて表示する）
    <>
      {/* ページコンテンツ（スプラッシュの裏でも読み込みを進める） */}
      {renderPage()}

      {/* スプラッシュ画面（showSplash が true の間だけ前面に表示する） */}
      {showSplash && <Splash fadingOut={splashFadingOut} />}
    </>
  );
}

// App コンポーネントをデフォルトエクスポートする
export default App;
