// React 本体を取り込み（JSX 変換は react-jsx）
import type { ReactElement, ReactNode } from "react";
// core から Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";
// Context を取り込み
import { LoggerContext } from "./context.js";

// Provider の props
export interface LoggerProviderProps {
  // 提供する Logger 本体
  logger: Logger;
  // 子要素
  children: ReactNode;
}

// 子ツリーに Logger を流すコンポーネント
export function LoggerProvider(props: LoggerProviderProps): ReactElement {
  // Context の value に Logger を渡し、children をそのまま描画
  return <LoggerContext.Provider value={props.logger}>{props.children}</LoggerContext.Provider>;
}
