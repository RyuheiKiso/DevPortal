// アプリのルートコンポーネント
// RouterProvider と ToastProvider でアプリ全体を包み、AppShell にレイアウトを委任する
// ThemeProvider は main.tsx で既に適用しているためここでは不要

// ルーティングプロバイダーをインポートする
import { RouterProvider } from './router/router';
// トースト通知プロバイダーをインポートする
import { ToastProvider } from './ui/ToastProvider';
// シェルレイアウトコンポーネントをインポートする
import { AppShell } from './shell/AppShell';

// アプリのルートコンポーネント（シンプルなプロバイダー合成のみ）
function App() {
  // RouterProvider でハッシュルーティングを有効にし
  // ToastProvider でアプリ全体からトースト通知を利用可能にし
  // AppShell がトップバー・サイドバー・メインのレイアウトとルートを担当する
  return (
    <RouterProvider>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </RouterProvider>
  );
}

// App コンポーネントをデフォルトエクスポートする
export default App;
