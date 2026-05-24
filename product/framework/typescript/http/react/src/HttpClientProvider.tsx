// React 型を取り込み
import type { ReactElement, ReactNode } from "react";
// HTTP クライアント型
import type { HttpClient } from "@k1s0-ts-http/core";
// Context を取り込み
import { HttpClientContext } from "./context.js";

// HttpClientProvider の props（client と子要素）
export interface HttpClientProviderProps {
  // 配信する HttpClient（createHttpClient の戻り値）
  client: HttpClient;
  // 子要素
  children: ReactNode;
}

// HttpClient を Context 経由で配信する Provider
// React 19 で JSX.Element 型が global から消えたため戻り値型は ReactElement を使う
export function HttpClientProvider(props: HttpClientProviderProps): ReactElement {
  return (
    <HttpClientContext.Provider value={props.client}>
      {props.children}
    </HttpClientContext.Provider>
  );
}
