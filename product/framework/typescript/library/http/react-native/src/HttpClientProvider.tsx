// React 型を取り込み
import type { ReactElement, ReactNode } from "react";
// HTTP クライアント型
import type { HttpClient } from "@k1s0-ts-http/core";
// Context を取り込み
import { HttpClientContext } from "./context.js";

// HttpClientProvider の props
export interface HttpClientProviderProps {
  // 配信する HttpClient
  client: HttpClient;
  // 子要素
  children: ReactNode;
}

// HttpClient を Context 経由で配信する Provider（RN 版、react 版と同実装）
export function HttpClientProvider(props: HttpClientProviderProps): ReactElement {
  return (
    <HttpClientContext.Provider value={props.client}>
      {props.children}
    </HttpClientContext.Provider>
  );
}
