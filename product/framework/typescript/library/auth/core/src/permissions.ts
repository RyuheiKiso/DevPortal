// 権限判定に必要な型を取り込み
import type { AccessDecision, AccessRequirement, AuthSession, AuthUser } from "./types.js";
// 認証済み判定ヘルパを取り込み
import { isAuthenticated } from "./session.js";

// 値一覧を Set に変換して大小文字は維持したまま高速比較できるようにする
function toSet(values: readonly string[]): Set<string> {
  // 配列から Set を生成する
  return new Set(values);
}

// required のうち owned に存在しない値を返す
function collectMissing(owned: readonly string[], required: readonly string[]): readonly string[] {
  // 所有値を Set 化する
  const ownedSet = toSet(owned);
  // required から不足値だけを抽出する
  return required.filter((value) => !ownedSet.has(value));
}

// required のいずれかを owned が含むか判定する
function includesAny(owned: readonly string[], required: readonly string[]): boolean {
  // required が空なら条件なしとして true
  if (required.length === 0) return true;
  // 所有値を Set 化する
  const ownedSet = toSet(owned);
  // いずれか一致すれば true
  return required.some((value) => ownedSet.has(value));
}

// required のすべてを owned が含むか判定する
function includesAll(owned: readonly string[], required: readonly string[]): boolean {
  // 不足値が 0 件ならすべて満たしている
  return collectMissing(owned, required).length === 0;
}

// ユーザーが指定ロールを持つか判定する
export function hasRole(user: AuthUser | null, role: string): boolean {
  // user が null の場合は false
  if (user === null) return false;
  // roles に指定値が含まれるか返す
  return user.roles.includes(role);
}

// ユーザーが指定権限を持つか判定する
export function hasPermission(user: AuthUser | null, permission: string): boolean {
  // user が null の場合は false
  if (user === null) return false;
  // permissions に指定値が含まれるか返す
  return user.permissions.includes(permission);
}

// ユーザーが指定ロールをすべて持つか判定する
export function hasAllRoles(user: AuthUser | null, roles: readonly string[]): boolean {
  // user が null の場合は要求が空のときだけ true
  if (user === null) return roles.length === 0;
  // 全ロールの包含を判定する
  return includesAll(user.roles, roles);
}

// ユーザーが指定ロールのいずれかを持つか判定する
export function hasAnyRole(user: AuthUser | null, roles: readonly string[]): boolean {
  // user が null の場合は要求が空のときだけ true
  if (user === null) return roles.length === 0;
  // いずれかのロール包含を判定する
  return includesAny(user.roles, roles);
}

// ユーザーが指定権限をすべて持つか判定する
export function hasAllPermissions(user: AuthUser | null, permissions: readonly string[]): boolean {
  // user が null の場合は要求が空のときだけ true
  if (user === null) return permissions.length === 0;
  // 全権限の包含を判定する
  return includesAll(user.permissions, permissions);
}

// ユーザーが指定権限のいずれかを持つか判定する
export function hasAnyPermission(user: AuthUser | null, permissions: readonly string[]): boolean {
  // user が null の場合は要求が空のときだけ true
  if (user === null) return permissions.length === 0;
  // いずれかの権限包含を判定する
  return includesAny(user.permissions, permissions);
}

// セッションと要件からアクセス可否を判定する
export function canAccess(session: AuthSession, requirement: AccessRequirement): AccessDecision {
  // 認証必須かつ匿名の場合は即座に拒否する
  if (requirement.authenticated === true && !isAuthenticated(session)) {
    // 匿名拒否の詳細を返す
    return { allowed: false, missingRoles: [], missingPermissions: [], reason: "anonymous" };
  }
  // 要件ロール一覧を空配列に正規化する
  const roles = requirement.roles ?? [];
  // 要件権限一覧を空配列に正規化する
  const permissions = requirement.permissions ?? [];
  // mode 未指定時は安全側で all とする
  const mode = requirement.mode ?? "all";
  // 現在ユーザーを取り出す
  const user = session.user;
  // all 判定で不足しているロールを集める
  const missingRoles = user === null ? roles : collectMissing(user.roles, roles);
  // all 判定で不足している権限を集める
  const missingPermissions =
    user === null ? permissions : collectMissing(user.permissions, permissions);
  // all モードでは全要件を満たす必要がある
  if (mode === "all") {
    // 不足がなければ許可する
    if (missingRoles.length === 0 && missingPermissions.length === 0) {
      // 許可結果を返す
      return { allowed: true, missingRoles: [], missingPermissions: [] };
    }
    // ロール不足を優先理由として返す
    if (missingRoles.length > 0) {
      // ロール不足の詳細を返す
      return { allowed: false, missingRoles, missingPermissions, reason: "missing-role" };
    }
    // 権限不足の詳細を返す
    return { allowed: false, missingRoles, missingPermissions, reason: "missing-permission" };
  }
  // any モードではロールまたは権限のいずれかを満たせばよい
  const roleMatched = hasAnyRole(user, roles);
  // any モードではロールまたは権限のいずれかを満たせばよい
  const permissionMatched = hasAnyPermission(user, permissions);
  // 要件が空なら許可する
  if (roles.length === 0 && permissions.length === 0) {
    // 許可結果を返す
    return { allowed: true, missingRoles: [], missingPermissions: [] };
  }
  // いずれか一致していれば許可する
  if (roleMatched || permissionMatched) {
    // 許可結果を返す
    return { allowed: true, missingRoles: [], missingPermissions: [] };
  }
  // ここに到達するのは roles 要件がありロールがすべて不一致のケース（roles=[] なら hasAnyRole が常に true となり ここに来ない）
  return { allowed: false, missingRoles, missingPermissions, reason: "missing-role" };
}
