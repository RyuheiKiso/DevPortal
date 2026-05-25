// React の型を取り込み
import type { ReactElement, ReactNode } from "react";
// core から StorageRegistry 型を取り込み
import type { StorageRegistry } from "@k1s0-ts-storage/core";
// Context を取り込み
import { StorageContext } from "./context.js";

// StorageProvider に受け入れる props
export interface StorageProviderProps {
  // 注入する StorageRegistry (アプリの起動時に組み立てて渡す)
  registry: StorageRegistry;
  // 子要素
  children: ReactNode;
}

// StorageRegistry を流す Provider 本体
// Manager 系のような内部生成は提供しない (DI 注入が常に明示的で済むため意図的に簡素化)
export function StorageProvider(props: StorageProviderProps): ReactElement {
  // Provider を返す (registry を value にそのまま流す)
  return <StorageContext.Provider value={props.registry}>{props.children}</StorageContext.Provider>;
}
