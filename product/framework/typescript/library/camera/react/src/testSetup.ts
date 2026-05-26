// vitest setup ファイル
// React 19 で globalThis.IS_REACT_ACT_ENVIRONMENT を必要とするテストへの保険
// 注: 本パッケージは react 18 を peer に取るが、React 19 環境でも壊れないように設定する
// vi はテスト中だけ存在する
import { vi } from "vitest";

// IS_REACT_ACT_ENVIRONMENT を true に
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// console.error の "act" 警告を抑制（react-test-renderer 由来）
const originalError = console.error;
// テスト全体で console.error を hook
console.error = (...args: unknown[]): void => {
  // 第 1 引数が文字列で「act(」を含む場合は無視
  if (typeof args[0] === "string" && args[0].includes("act(")) {
    return;
  }
  // それ以外は元実装に転送
  originalError(...(args as Parameters<typeof originalError>));
};

// vi の存在を残す（未使用警告抑制）
void vi;
