// React 型（ReactNode, ReactElement）を取り込み
import type { ReactNode, ReactElement } from "react";
// 基底コンフィグ型を core から取り込み
import type { BaseConfig } from "@k1s0-ts-config/core";
// Context 本体
import { ConfigContext } from "./context.js";

// ConfigProvider の props
// 設定型 T を BaseConfig の派生に制限してジェネリクスを維持
export interface ConfigProviderProps<T extends BaseConfig> {
  // 提供する設定オブジェクト
  config: T;
  // ラップする子要素
  children: ReactNode;
}

// React Native アプリ用の設定 Provider
// 実装上は react 版と同じだが、将来 AppState 連動などの RN 固有処理を追加する余地のため別実装
export function ConfigProvider<T extends BaseConfig>(
  // ジェネリクスを保つため props 全体を受ける
  props: ConfigProviderProps<T>,
): ReactElement {
  // Context.Provider で value を提供
  return (
    <ConfigContext.Provider value={props.config}>
      {props.children}
    </ConfigContext.Provider>
  );
}
