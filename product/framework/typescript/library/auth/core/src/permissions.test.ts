// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象を取り込み
import {
  canAccess,
  hasAllPermissions,
  hasAllRoles,
  hasAnyPermission,
  hasAnyRole,
  hasPermission,
  hasRole,
} from "./permissions.js";
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
// 匿名セッション（user = null）
const anonymousSession: AuthSession = { status: "anonymous", user: null };

// 単純判定系のテスト
describe("role and permission helpers", () => {
  // ロール有無を判定できること
  it("ロールを判定する", () => {
    // admin ロールは true
    expect(hasRole(session.user, "admin")).toBe(true);
    // auditor ロールは false
    expect(hasRole(session.user, "auditor")).toBe(false);
  });

  // user が null の場合は常に false を返すこと
  it("user が null のとき hasRole / hasPermission は常に false", () => {
    // null user
    expect(hasRole(null, "admin")).toBe(false);
    // null user
    expect(hasPermission(null, "invoice:read")).toBe(false);
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
    // 一部 lack
    expect(hasAllRoles(session.user, ["admin", "auditor"])).toBe(false);
    // invoice:delete は持たないが invoice:read は持つ
    expect(hasAnyPermission(session.user, ["invoice:delete", "invoice:read"])).toBe(true);
    // どの権限も持たない
    expect(hasAnyPermission(session.user, ["invoice:delete"])).toBe(false);
    // すべて持つ
    expect(hasAllPermissions(session.user, ["invoice:read", "invoice:write"])).toBe(true);
    // いずれかのロールを持つ
    expect(hasAnyRole(session.user, ["auditor", "admin"])).toBe(true);
  });

  // user が null かつ要求が空配列なら true、非空なら false になること
  it("user が null のとき all/any 系は要求が空のときだけ true を返す", () => {
    // 空要求
    expect(hasAllRoles(null, [])).toBe(true);
    // 空要求
    expect(hasAnyRole(null, [])).toBe(true);
    // 空要求
    expect(hasAllPermissions(null, [])).toBe(true);
    // 空要求
    expect(hasAnyPermission(null, [])).toBe(true);
    // 非空要求
    expect(hasAllRoles(null, ["admin"])).toBe(false);
    // 非空要求
    expect(hasAnyRole(null, ["admin"])).toBe(false);
    // 非空要求
    expect(hasAllPermissions(null, ["x"])).toBe(false);
    // 非空要求
    expect(hasAnyPermission(null, ["x"])).toBe(false);
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
    // 不足ロール無し
    expect(decision.missingRoles).toEqual([]);
    // 不足権限無し
    expect(decision.missingPermissions).toEqual([]);
  });

  // 要件が空なら allowed=true を返すこと
  it("要件が空（mode=all 既定）なら許可する", () => {
    // 空要件
    const decision = canAccess(session, {});
    // 許可されること
    expect(decision.allowed).toBe(true);
  });

  // 匿名には認証必須を拒否すること
  it("匿名に認証必須要件を拒否する", () => {
    // 匿名セッションで認証必須を要求する
    const decision = canAccess(anonymousSession, { authenticated: true });
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
    // ロール不足が優先理由として返ること
    expect(decision.reason).toBe("missing-role");
  });

  // all モードでロールは満たすが権限が不足する場合は missing-permission を返すこと
  it("all モードでロールは満たすが権限が不足する場合は missing-permission を返す", () => {
    // 権限のみ不足
    const decision = canAccess(session, {
      // 既存のロールのみ要求
      roles: ["admin"],
      // 不足する権限を要求
      permissions: ["invoice:delete"],
    });
    // 拒否
    expect(decision.allowed).toBe(false);
    // 理由は権限不足
    expect(decision.reason).toBe("missing-permission");
  });

  // all モードで user=null かつ要件が空配列のときは許可されること
  it("all モードで user=null かつ要件が空のとき allowed=true", () => {
    // authenticated:false（既定）で空要件
    const decision = canAccess(anonymousSession, {});
    // 許可
    expect(decision.allowed).toBe(true);
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

  // any モードで要件が空配列なら許可すること
  it("any モードで要件が空のとき allowed=true", () => {
    // any モードで空要件
    const decision = canAccess(session, { mode: "any" });
    // 許可
    expect(decision.allowed).toBe(true);
  });

  // any モードでロールも権限も一致しない場合は missing-role を返すこと（ロール要件がある場合）
  it("any モードでロール要件があり一致しない場合は missing-role", () => {
    // どちらも一致しない（ただしロール要件あり）
    const decision = canAccess(session, {
      // any モード
      mode: "any",
      // 存在しないロール
      roles: ["auditor"],
      // 存在しない権限
      permissions: ["invoice:delete"],
    });
    // 拒否
    expect(decision.allowed).toBe(false);
    // ロール不足が理由
    expect(decision.reason).toBe("missing-role");
  });

  // user=null のときの missingRoles / missingPermissions は要件配列そのまま
  it("user=null のとき missing 一覧は要件配列そのまま", () => {
    // 認証必須を外し、要件で拒否させる
    const decision = canAccess(anonymousSession, {
      // ロール要件あり
      roles: ["admin"],
      // 権限要件あり
      permissions: ["invoice:read"],
    });
    // 拒否
    expect(decision.allowed).toBe(false);
    // 要件配列がそのまま不足として返る
    expect(decision.missingRoles).toEqual(["admin"]);
    // 要件配列がそのまま不足として返る
    expect(decision.missingPermissions).toEqual(["invoice:read"]);
  });
});
