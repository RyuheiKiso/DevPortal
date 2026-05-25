// React の createContext を取り込み
import { createContext } from "react";
// core から型を取り込み
import type { AuthManager, AuthSession } from "@k1s0-ts-auth/core";

// React Native Context に載せる値の型
export interface AuthContextValue {
  // 認証操作を担う manager
  manager: AuthManager;
  // 現在のセッション
  session: AuthSession;
  // 初期ロードまたは再ロード中か
  loading: boolean;
  // セッション取得時のエラー
  error: unknown;
  // セッションを再取得する関数
  reload(): Promise<AuthSession>;
}

// 認証状態を React Native アプリ全体へ伝搬する Context
export const AuthContext = createContext<AuthContextValue | null>(null);
