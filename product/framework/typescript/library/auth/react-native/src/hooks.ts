// React の useContext を取り込み
import { useContext } from "react";
// core から型を取り込み
import type { AccessDecision, AccessRequirement, AuthManager, AuthSession, AuthUser } from "@k1s0-ts-auth/core";
// Context 本体と型を取り込み
import { AuthContext, type AuthContextValue } from "./context.js";

// Provider 外で呼ばれた場合に throw する明示エラー
function ensureContext(value: AuthContextValue | null): AuthContextValue {
  // null のとき（Provider 不在）は早期エラー
  if (value === null) {
    // 利用方法が分かるエラーを投げる
    throw new Error("useAuth must be called inside <AuthProvider>");
  }
  // Context 値を返す
  return value;
}

// AuthContext 全体を取得する hook
export function useAuthContext(): AuthContextValue {
  // React Context から値を取り出す
  const value = useContext(AuthContext);
  // null チェック付きで返す
  return ensureContext(value);
}

// AuthManager を取得する hook
export function useAuth(): AuthManager {
  // Context から manager を返す
  return useAuthContext().manager;
}

// 現在セッションを取得する hook
export function useAuthSession(): AuthSession {
  // Context から session を返す
  return useAuthContext().session;
}

// 現在ユーザーを取得する hook
export function useCurrentUser(): AuthUser | null {
  // セッションから user を返す
  return useAuthSession().user;
}

// 認証済みかを取得する hook
export function useIsAuthenticated(): boolean {
  // セッションを取得する
  const session = useAuthSession();
  // status と user の両方を見て返す
  return session.status === "authenticated" && session.user !== null;
}

// 指定ロールを持つか判定する hook
export function useRole(role: string): boolean {
  // manager の判定へ委譲する
  return useAuth().hasRole(role);
}

// 指定権限を持つか判定する hook
export function usePermission(permission: string): boolean {
  // manager の判定へ委譲する
  return useAuth().hasPermission(permission);
}

// 複合要件を満たすか判定する hook
// 注意: 返り値の AccessDecision は呼び出すたびに manager.canAccess が組み立てる新規オブジェクト
// のため、参照同一性は保証しない。useEffect の依存配列に直接渡すと再 render のたびに
// effect が再実行される。安定参照が必要なら `.allowed` 等プリミティブを取り出して依存に渡すか、
// 呼び出し側で useMemo で安定化すること
export function useAccess(requirement: AccessRequirement): AccessDecision {
  // manager の判定へ委譲する
  return useAuth().canAccess(requirement);
}
