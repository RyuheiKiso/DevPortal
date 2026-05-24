// 最小 Logger 契約
import type { Logger } from "./types.js";

// 何もしない Logger 実装（logger 未指定時のデフォルトとして使用）
// 単体の関数オブジェクトを公開することで参照同一性と tree-shake を両立
export const noopLogger: Logger = {
  // 全メソッドが no-op（呼ばれても副作用なし）
  debug: (): void => {
    // 意図的に空（noop）
  },
  info: (): void => {
    // 意図的に空（noop）
  },
  warn: (): void => {
    // 意図的に空（noop）
  },
  error: (): void => {
    // 意図的に空（noop）
  },
};
