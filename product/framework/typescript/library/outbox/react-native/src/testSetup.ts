// React のエラー出力を抑制するための setup
import { vi } from "vitest";

// 元の console.error
const originalError = console.error.bind(console);

// 既知の React 内部エラーは無視
vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  const message = String(args[0] ?? "");
  if (message.includes("The above error occurred in the <ManagerProbe> component")) {
    return;
  }
  originalError(...args);
});
