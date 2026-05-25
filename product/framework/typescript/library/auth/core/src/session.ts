// セッション関連の型を取り込み
import type { AuthSession, AuthUser } from "./types.js";

// 匿名セッションを新しく作る
export function createAnonymousSession(): AuthSession {
  // 共有オブジェクトの accidental mutation を避けるため毎回生成する
  return { status: "anonymous", user: null };
}

// ユーザー配列系プロパティを安全な配列に正規化する
function normalizeUser(user: AuthUser): AuthUser {
  // roles / permissions が外部由来でも readonly 配列として扱える形にする
  return {
    // ID は必須値としてそのまま保持する
    id: user.id,
    // 表示名は任意値としてそのまま保持する
    displayName: user.displayName,
    // メールアドレスは任意値としてそのまま保持する
    email: user.email,
    // ロール一覧はコピーして外部 mutation を遮断する
    roles: [...user.roles],
    // 権限一覧はコピーして外部 mutation を遮断する
    permissions: [...user.permissions],
    // 追加属性は shallow copy して外部 mutation を遮断する
    attributes: user.attributes === undefined ? undefined : { ...user.attributes },
  };
}

// AuthSession を安全に保持できる形へ正規化する
export function normalizeSession(session: AuthSession | undefined): AuthSession {
  // 未指定は匿名セッションとして扱う
  if (session === undefined) {
    // 匿名セッションを返す
    return createAnonymousSession();
  }
  // authenticated でも user が null なら不正なので匿名に倒す
  if (session.status !== "authenticated" || session.user === null) {
    // 匿名セッションを返す
    return createAnonymousSession();
  }
  // 認証済みセッションをコピーして返す
  return {
    // 認証済み状態を保持する
    status: "authenticated",
    // ユーザー情報を正規化する
    user: normalizeUser(session.user),
    // トークン集合は shallow copy する
    tokens: session.tokens === undefined ? undefined : { ...session.tokens },
    // クレームは shallow copy する
    claims: session.claims === undefined ? undefined : { ...session.claims },
  };
}

// セッションが認証済みか判定する
export function isAuthenticated(session: AuthSession): boolean {
  // status と user の両方を見て防御的に判定する
  return session.status === "authenticated" && session.user !== null;
}
