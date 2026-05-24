// React の型を取り込み（ReactNode, ReactElement）
import type { ReactNode, ReactElement } from "react";
// 基底コンフィグ型を core から取り込み
import type { BaseConfig } from "@k1s0-ts-config/core";
// 上で定義した Context を取り込み
import { ConfigContext } from "./context.js";

// ConfigProvider の props 型
// T で BaseConfig の派生型を許容（feature flag のキー型を絞り込めるようにジェネリクス化）
export interface ConfigProviderProps<T extends BaseConfig> {
  // アプリ全体に提供する設定オブジェクト
  config: T;
  // ラップする子要素
  children: ReactNode;
}

// Context 経由で設定値を提供する Provider コンポーネント
// 子コンポーネントは useConfig() などの hook から config を取り出せる
export function ConfigProvider<T extends BaseConfig>(
  // props を分解せず受ける（ジェネリクスを保つため）
  props: ConfigProviderProps<T>,
): ReactElement {
  // ConfigContext の Provider に value を渡してラップ
  return (
    <ConfigContext.Provider value={props.config}>
      {props.children}
    </ConfigContext.Provider>
  );
}
