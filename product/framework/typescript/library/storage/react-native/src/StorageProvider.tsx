// React の型を取り込み
import type { ReactElement, ReactNode } from "react";
// core から StorageRegistry 型を取り込み
import type { StorageRegistry } from "@k1s0-ts-storage/core";
// Context を取り込み
import { StorageContext } from "./context.js";

// StorageProvider に受け入れる props
export interface StorageProviderProps {
  // 注入する StorageRegistry (アプリ起動時に組み立てて渡す)
  registry: StorageRegistry;
  // 子要素
  children: ReactNode;
}

// StorageRegistry を流す Provider 本体
// react-native では cross-tab イベントが無いため Web 版より単純化された設計
export function StorageProvider(props: StorageProviderProps): ReactElement {
  // Provider を返す (registry を value にそのまま流す)
  return <StorageContext.Provider value={props.registry}>{props.children}</StorageContext.Provider>;
}
