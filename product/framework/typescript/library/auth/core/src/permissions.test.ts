// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象を取り込み
import { canAccess, hasAllRoles, hasAnyPermission, hasPermission, hasRole } from "./permissions.js";
// セッション型を取り込み
import type { AuthSession } from "./types.js";

// 認証済みセッションのテストデータを定義
const session: AuthSession = {
  // 認証済み状態
  status: "authenticated",
  // ユーザー情報
  user: {
    // ユーザー ID
    id: "user-1",
    // ロール一覧
    roles: ["admin", "operator"],
    // 権限一覧
    permissions: ["invoice:read", "invoice:write"],
  },
};

// 単純判定系のテスト
describe("role and permission helpers", () => {
  // ロール有無を判定できること
  it("ロールを判定する", () => {
    // admin ロールは true
    expect(hasRole(session.user, "admin")).toBe(true);
    // auditor ロールは false
    expect(hasRole(session.user, "auditor")).toBe(false);
  });

  // 権限有無を判定できること
  it("権限を判定する", () => {
    // invoice:read 権限は true
    expect(hasPermission(session.user, "invoice:read")).toBe(true);
    // invoice:delete 権限は false
    expect(hasPermission(session.user, "invoice:delete")).toBe(false);
  });

  // 複数要件を判定できること
  it("all / any の複数要件を判定する", () => {
    // admin と operator はすべて満たす
    expect(hasAllRoles(session.user, ["admin", "operator"])).toBe(true);
    // invoice:delete は持たないが invoice:read は持つ
    expect(hasAnyPermission(session.user, ["invoice:delete", "invoice:read"])).toBe(true);
  });
});

// 複合アクセス判定のテスト
describe("canAccess", () => {
  // 認証済みかつ必要権限があれば許可すること
  it("必要要件を満たす場合は許可する", () => {
    // admin と invoice:read を要求する
    const decision = canAccess(session, {
      // 認証済みを要求する
      authenticated: true,
      // admin ロールを要求する
      roles: ["admin"],
      // invoice:read 権限を要求する
      permissions: ["invoice:read"],
    });
    // 許可されること
    expect(decision.allowed).toBe(true);
  });

  // 匿名には認証必須を拒否すること
  it("匿名に認証必須要件を拒否する", () => {
    // 匿名セッションで認証必須を要求する
    const decision = canAccess({ status: "anonymous", user: null }, { authenticated: true });
    // 拒否されること
    expect(decision.allowed).toBe(false);
    // 理由が anonymous であること
    expect(decision.reason).toBe("anonymous");
  });

  // all モードで不足を返すこと
  it("all モードでは不足ロールと不足権限を返す", () => {
    // 不足する role と permission を要求する
    const decision = canAccess(session, {
      // auditor ロールを要求する
      roles: ["auditor"],
      // invoice:delete 権限を要求する
      permissions: ["invoice:delete"],
    });
    // 拒否されること
    expect(decision.allowed).toBe(false);
    // 不足ロールを返すこと
    expect(decision.missingRoles).toEqual(["auditor"]);
    // 不足権限を返すこと
    expect(decision.missingPermissions).toEqual(["invoice:delete"]);
  });

  // any モードでどちらかが一致すれば許可すること
  it("any モードではロールか権限のどちらかが一致すれば許可する", () => {
    // 存在しない role と存在する permission を要求する
    const decision = canAccess(session, {
      // any モードにする
      mode: "any",
      // 存在しないロール
      roles: ["auditor"],
      // 存在する権限
      permissions: ["invoice:read"],
    });
    // 許可されること
    expect(decision.allowed).toBe(true);
  });
});
