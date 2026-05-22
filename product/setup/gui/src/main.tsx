// React ライブラリ本体をインポート
import React from "react";
// React 18 系の DOM レンダリング API をインポート
import ReactDOM from "react-dom/client";
// グローバル CSS（tokens.css と global.css を内部でインポートしている）をインポート
import "./index.css";
// アプリのルートコンポーネントをインポート
import App from "./App";
// テーマ（ライト/ダーク/OS 追従）の切り替えと永続化を管理するプロバイダーをインポート
import { ThemeProvider } from "./theme/ThemeProvider";

// index.html の <div id="root"> 要素にルートを生成して App をレンダリングする
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  // 開発時の副作用検出のために StrictMode で包む
  <React.StrictMode>
    {/* テーマ管理プロバイダーでアプリ全体を包み、useTheme() フックを子で利用可能にする */}
    <ThemeProvider>
      {/* アプリのルートコンポーネント */}
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
