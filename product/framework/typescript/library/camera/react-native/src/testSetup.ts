// vitest setup（react 版と同等、React 19 用 act 警告を抑制）
import { vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalError = console.error;
console.error = (...args: unknown[]): void => {
  if (typeof args[0] === "string" && args[0].includes("act(")) {
    return;
  }
  originalError(...(args as Parameters<typeof originalError>));
};

void vi;
