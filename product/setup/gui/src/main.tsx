// React ライブラリ本体をインポート
import React from "react";
// React 18 系の DOM レンダリング API をインポート
import ReactDOM from "react-dom/client";
// アプリのルートコンポーネントをインポート
import App from "./App";

// index.html の <div id="root"> 要素にルートを生成して App をレンダリング
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  // 開発時の副作用検出のために StrictMode で包む
  <React.StrictMode>
    {/* アプリのルートコンポーネント */}
    <App />
  </React.StrictMode>
);
