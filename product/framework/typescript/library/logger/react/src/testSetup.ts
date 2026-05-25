// vitest 本体から spy ユーティリティを取り込み
import { vi } from "vitest";

// React 19 test renderer に act 環境であることを明示する
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom が `error` / `unhandledrejection` の既定処理として Node へ propagate するのを抑止する
// （テスト中に意図的に dispatchEvent するため、ここで一度だけ preventDefault を設定）
if (typeof window !== "undefined") {
  // 既定アクションを抑止する no-op リスナ（テスト本体のリスナとは独立に動作）
  window.addEventListener("error", (event) => event.preventDefault());
  // unhandledrejection も同様に既定アクションを抑止
  window.addEventListener("unhandledrejection", (event) => event.preventDefault());
}

// 元の console.error を退避（抑制しないログだけ素通しさせるため）
const originalError = console.error.bind(console);

// React の boundary キャッチログや非同期 act 警告だけをノイズとして抑制
vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  // 第 1 引数を string 化して既知パターンと突き合わせる
  const message = String(args[0] ?? "");
  // react-test-renderer の非推奨警告を抑制（依存上の通知でテスト本質に影響しないため）
  if (message.includes("react-test-renderer is deprecated")) {
    return;
  }
  // boundary が拾った例外の React 標準ログを抑制（テストで意図的に投げる例外のため）
  if (message.includes("The above error occurred in")) {
    return;
  }
  // それ以外のエラーログは引き続き表示
  originalError(...args);
});
