// React のエラー出力を抑制するための setup (notification と同じ流儀)
import { vi } from "vitest";

// 元の console.error を保持
const originalError = console.error.bind(console);

// React 18+ では act() 警告などが大量に出るため、本テストで期待されるメッセージは黙らせる
vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  // 引数のメッセージ
  const message = String(args[0] ?? "");
  // 既知の React 内部エラーメッセージは無視する
  if (message.includes("The above error occurred in the <ManagerProbe> component")) {
    return;
  }
  // それ以外は元の console.error に流す
  originalError(...args);
});
