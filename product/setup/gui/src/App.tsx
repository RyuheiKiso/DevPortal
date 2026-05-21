// React のフック（useEffect / useState）をインポート
import { useEffect, useState } from "react";
// Tauri のフロントエンド API（Rust コマンドを呼び出す invoke）をインポート
import { invoke } from "@tauri-apps/api/core";

// アプリのルートコンポーネント
function App() {
  // Rust 側から受け取ったメッセージ文字列を保持する state
  const [message, setMessage] = useState<string>("");

  // 初回マウント時に一度だけ Rust 側の greet コマンドを呼び出す
  useEffect(() => {
    // greet コマンドを呼び出し、結果を state に反映（失敗時はコンソールへ）
    invoke<string>("greet").then(setMessage).catch(console.error);
  }, []);

  // 受け取った文字列を見出しとして表示
  return (
    // main 要素でラップ
    <main>
      {/* Rust から取得した Hello World を表示 */}
      <h1>{message}</h1>
    </main>
  );
}

// App コンポーネントをデフォルトエクスポート
export default App;
