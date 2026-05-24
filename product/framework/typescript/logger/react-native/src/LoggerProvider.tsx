// React の型を取り込み
import type { ReactElement, ReactNode } from "react";
// core から Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";
// Context を取り込み
import { LoggerContext } from "./context.js";

// Provider の props
export interface LoggerProviderProps {
  // 提供する Logger
  logger: Logger;
  // 子要素
  children: ReactNode;
}

// 子ツリーに Logger を流すコンポーネント
// 将来 AppState 連動などの RN 固有処理を追加する余地のため react とは別実装
export function LoggerProvider(props: LoggerProviderProps): ReactElement {
  return <LoggerContext.Provider value={props.logger}>{props.children}</LoggerContext.Provider>;
}
