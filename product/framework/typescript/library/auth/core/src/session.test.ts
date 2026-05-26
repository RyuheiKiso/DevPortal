// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象を取り込み
import { createAnonymousSession, isAuthenticated, normalizeSession } from "./session.js";
// 型を取り込み
import type { AuthSession, AuthUser } from "./types.js";

// 認証済みユーザーのサンプルを生成するヘルパ
function createUser(overrides: Partial<AuthUser> = {}): AuthUser {
  // 既定値を持つ AuthUser を返す
  return {
    // ID 必須
    id: "user-1",
    // 表示名は任意
    displayName: "Test User",
    // メールは任意
    email: "test@example.com",
    // ロール一覧
    roles: ["admin"],
    // 権限一覧
    permissions: ["invoice:read"],
    // 追加属性
    attributes: { tenant: "default" },
    // 呼び出し側の上書きを最後に反映する
    ...overrides,
  };
}

// createAnonymousSession のテスト群
describe("createAnonymousSession", () => {
  // 毎回新しい匿名セッションを返すこと
  it("常に独立した匿名セッションを返す", () => {
    // 2 回呼ぶ
    const a = createAnonymousSession();
    // 2 つ目の呼び出し
    const b = createAnonymousSession();
    // 状態は anonymous
    expect(a.status).toBe("anonymous");
    // user は null
    expect(a.user).toBeNull();
    // 異なる参照（共有オブジェクトでない）であること
    expect(a).not.toBe(b);
  });
});

// normalizeSession のテスト群
describe("normalizeSession", () => {
  // undefined を匿名セッションに変換すること
  it("undefined を匿名セッションに変換する", () => {
    // undefined を渡す
    const session = normalizeSession(undefined);
    // 匿名状態であること
    expect(session.status).toBe("anonymous");
    // user は null であること
    expect(session.user).toBeNull();
  });

  // 匿名セッションを安全に正規化すること（authenticated 以外は匿名へ）
  it("anonymous ステータスを匿名セッションに正規化する", () => {
    // anonymous を渡す
    const session = normalizeSession({ status: "anonymous", user: null });
    // 匿名状態であること
    expect(session.status).toBe("anonymous");
    // user は null であること
    expect(session.user).toBeNull();
  });

  // status=authenticated だが user=null の不整合を匿名へ倒すこと
  it("authenticated × user=null の不整合を匿名に倒す", () => {
    // 不整合な入力を渡す
    const session = normalizeSession({ status: "authenticated", user: null });
    // 匿名へ落ちること
    expect(session.status).toBe("anonymous");
    // user も null になること
    expect(session.user).toBeNull();
  });

  // roles / permissions が外部 mutation で破壊されないこと
  it("配列を独立した複製として保持し外部 mutation を遮断する", () => {
    // 外部から差し替え可能な配列を用意
    const externalRoles = ["admin"];
    // 外部から差し替え可能な配列を用意
    const externalPermissions = ["invoice:read"];
    // 認証済みセッションを作る
    const session = normalizeSession({
      // 認証済み状態
      status: "authenticated",
      // 上記配列を参照に保持
      user: createUser({ roles: externalRoles, permissions: externalPermissions }),
    });
    // 外部配列を変更する
    externalRoles.push("ghost");
    // 外部配列を変更する
    externalPermissions.push("invoice:delete");
    // 内部 roles は影響を受けないこと
    expect(session.user?.roles).toEqual(["admin"]);
    // 内部 permissions は影響を受けないこと
    expect(session.user?.permissions).toEqual(["invoice:read"]);
  });

  // attributes が指定された場合は shallow copy になること
  it("attributes を shallow copy する", () => {
    // 元 attributes
    const attributes = { tenant: "alpha" };
    // 認証済みセッションを正規化
    const session = normalizeSession({
      // 認証済み状態
      status: "authenticated",
      // user を作る
      user: createUser({ attributes }),
    });
    // 元オブジェクトを変更する
    attributes.tenant = "beta";
    // 内部状態は影響を受けないこと
    expect(session.user?.attributes).toEqual({ tenant: "alpha" });
    // 参照は異なること
    expect(session.user?.attributes).not.toBe(attributes);
  });

  // attributes 未指定はそのまま undefined を保つこと
  it("attributes 未指定時は undefined のままにする", () => {
    // attributes を持たない user を渡す
    const session = normalizeSession({
      // 認証済み状態
      status: "authenticated",
      // attributes を省略
      user: createUser({ attributes: undefined }),
    });
    // attributes が undefined であること
    expect(session.user?.attributes).toBeUndefined();
  });

  // tokens / claims を shallow copy すること
  it("tokens と claims を shallow copy する", () => {
    // 元 tokens
    const tokens = { accessToken: "a", refreshToken: "r" };
    // 元 claims
    const claims = { iss: "issuer" };
    // 認証済みセッションを正規化
    const session = normalizeSession({
      // 認証済み状態
      status: "authenticated",
      // user
      user: createUser(),
      // tokens を渡す
      tokens,
      // claims を渡す
      claims,
    });
    // 元 tokens を変更する
    tokens.accessToken = "mutated";
    // 元 claims を変更する
    (claims as Record<string, unknown>).iss = "mutated-issuer";
    // 正規化後の tokens は影響を受けないこと
    expect(session.tokens?.accessToken).toBe("a");
    // 正規化後の claims は影響を受けないこと
    expect(session.claims?.iss).toBe("issuer");
  });

  // tokens / claims を省略した場合は undefined のままにすること
  it("tokens / claims 省略時は undefined を維持する", () => {
    // tokens と claims を省略した認証済みセッション
    const session = normalizeSession({
      // 認証済み状態
      status: "authenticated",
      // 最低限の user のみ
      user: createUser(),
    });
    // tokens が undefined であること
    expect(session.tokens).toBeUndefined();
    // claims が undefined であること
    expect(session.claims).toBeUndefined();
  });
});

// 設計ポリシー文書化のためのテスト (normalizeSession の anonymous 入力では tokens / claims が破棄されることを契約として固定する)
describe("normalizeSession の anonymous 入力 (#4 設計ポリシー)", () => {
  // status=anonymous の入力に tokens / claims が含まれていても破棄されること
  it("status=anonymous に渡された tokens / claims は破棄される", () => {
    // tokens と claims を持つ匿名入力を渡す
    const session = normalizeSession({
      // 匿名状態
      status: "anonymous",
      // user は null
      user: null,
      // ゲストトークン相当
      tokens: { accessToken: "guest-token" },
      // 任意のクレーム
      claims: { iss: "guest-idp" },
    });
    // 匿名セッションに正規化されること
    expect(session.status).toBe("anonymous");
    // tokens は破棄される (「匿名だがトークン保持」は本ライブラリの設計範囲外)
    expect(session.tokens).toBeUndefined();
    // claims も破棄される
    expect(session.claims).toBeUndefined();
  });
});

// shallow copy 仕様の文書化テスト (将来 deep copy 化したら期待値を更新する)
describe("normalizeSession の shallow copy 仕様 (#5 設計ポリシー)", () => {
  // attributes のネスト値は共有参照のまま (現契約の文書化テスト)
  it("attributes のネスト値は shared 参照のまま (将来 deep copy 化するなら期待値を更新する)", () => {
    // ネスト値を持つ attributes
    const attributes: Record<string, unknown> = { nested: { tenant: "alpha" } };
    // 認証済みセッションを正規化
    const session = normalizeSession({
      // 認証済み状態
      status: "authenticated",
      // ネストした attributes を持つ user
      user: createUser({ attributes }),
    });
    // ネスト値を外部から mutate する
    (attributes.nested as { tenant: string }).tenant = "beta";
    // shallow copy 仕様により内部状態にも反映されてしまうことを文書化
    expect((session.user?.attributes?.nested as { tenant: string }).tenant).toBe("beta");
  });
});

// isAuthenticated のテスト群
describe("isAuthenticated", () => {
  // 認証済み + user ありの場合のみ true を返すこと
  it("authenticated × user!=null のみ true を返す", () => {
    // 通常の認証済み
    const authed: AuthSession = { status: "authenticated", user: createUser() };
    // 認証済みなのに user=null の異常系
    const inconsistent: AuthSession = { status: "authenticated", user: null };
    // 匿名
    const anon: AuthSession = { status: "anonymous", user: null };
    // 認証済みは true
    expect(isAuthenticated(authed)).toBe(true);
    // 不整合は false
    expect(isAuthenticated(inconsistent)).toBe(false);
    // 匿名は false
    expect(isAuthenticated(anon)).toBe(false);
  });
});
