// React の型を取り込み
import type { ReactElement, ReactNode } from "react";
// core から型を取り込み
import type { AccessRequirement } from "@k1s0-ts-auth/core";
// アクセス判定 hook を取り込み
import { useAccess } from "./hooks.js";

// RequirePermission の props 型
export interface RequirePermissionProps {
  // 表示に必要な権限要件
  requirement: AccessRequirement;
  // 要件を満たすときに表示する子要素
  children: ReactNode;
  // 要件を満たさないときに表示する代替要素
  fallback?: ReactNode;
}

// 権限要件を満たすユーザーだけに子要素を表示するコンポーネント
export function RequirePermission(props: RequirePermissionProps): ReactElement {
  // アクセス判定結果を取得する
  const decision = useAccess(props.requirement);
  // 許可されていれば children を表示する
  if (decision.allowed) return <>{props.children}</>;
  // 拒否されていれば fallback を表示する
  return <>{props.fallback ?? null}</>;
}
