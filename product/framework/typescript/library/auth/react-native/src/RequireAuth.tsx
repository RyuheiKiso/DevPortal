// React の型を取り込み
import type { ReactElement, ReactNode } from "react";
// 認証状態 hook を取り込み
import { useIsAuthenticated } from "./hooks.js";

// RequireAuth の props 型
export interface RequireAuthProps {
  // 認証済みのときに表示する子要素
  children: ReactNode;
  // 匿名のときに表示する代替要素
  fallback?: ReactNode;
}

// 認証済みユーザーだけに子要素を表示するコンポーネント
export function RequireAuth(props: RequireAuthProps): ReactElement {
  // 認証済みかを取得する
  const authenticated = useIsAuthenticated();
  // 認証済みなら children を表示する
  if (authenticated) return <>{props.children}</>;
  // 匿名なら fallback を表示する
  return <>{props.fallback ?? null}</>;
}
