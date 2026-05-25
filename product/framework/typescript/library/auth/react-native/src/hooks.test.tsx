// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// React を取り込み
import * as React from "react";
// react-test-renderer を取り込み
import { act, create } from "react-test-renderer";
// core から manager 生成と型を取り込み
import { createAuthManager } from "@k1s0-ts-auth/core";
// 型を取り込み
import type { AuthAdapter, AuthSession } from "@k1s0-ts-auth/core";
// Provider を取り込み
import { AuthProvider } from "./AuthProvider.js";
// hooks を取り込み
import {
  useAccess,
  useAuth,
  useAuthContext,
  useAuthSession,
  useCurrentUser,
  useIsAuthenticated,
  usePermission,
  useRole,
} from "./hooks.js";

// 認証済みセッションを返すヘルパ
function makeAuthSession(): AuthSession {
  // 認証済みを返す
  return {
    // 認証済み
    status: "authenticated",
    // ユーザー
    user: {
      // id
      id: "user-1",
      // ロール
      roles: ["admin"],
      // 権限
      permissions: ["invoice:read"],
    },
    // トークン
    tokens: { accessToken: "token-1" },
  };
}

// hooks 群のテスト
describe("auth react-native hooks", () => {
  // Provider 配下で hooks が値を返すこと
  it("Provider 配下で各種 hook が manager と整合した値を返す", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 認証済み
      getSession: async () => makeAuthSession(),
    };
    // manager
    const manager = createAuthManager(adapter);
    // 事前ロード
    await manager.getSession();
    // captured
    const captured: Partial<Record<string, unknown>> = {};
    // Probe コンポーネント
    function Probe(): React.JSX.Element {
      // Context 全体
      const ctx = useAuthContext();
      // manager
      captured.manager = useAuth();
      // session
      captured.session = useAuthSession();
      // user
      captured.user = useCurrentUser();
      // 認証済みか
      captured.authenticated = useIsAuthenticated();
      // admin ロール
      captured.admin = useRole("admin");
      // invoice:read 権限
      captured.read = usePermission("invoice:read");
      // 複合判定
      captured.access = useAccess({ roles: ["admin"] });
      // 参照同一性
      captured.sameManager = ctx.manager === captured.manager;
      // 描画は空
      return <>{null}</>;
    }
    // 描画
    act(() => {
      // Provider
      create(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
    });
    // manager 参照が一致すること
    expect(captured.sameManager).toBe(true);
    // session が認証済み
    expect((captured.session as { status: string }).status).toBe("authenticated");
    // user が取得できる
    expect(captured.user).toMatchObject({ id: "user-1" });
    // 認証済みフラグ
    expect(captured.authenticated).toBe(true);
    // admin ロールあり
    expect(captured.admin).toBe(true);
    // invoice:read 権限あり
    expect(captured.read).toBe(true);
    // 複合判定 allowed
    expect((captured.access as { allowed: boolean }).allowed).toBe(true);
  });

  // Provider 外で hook を呼ぶと例外になること
  it("Provider 外で useAuthContext を呼ぶと明示エラー", () => {
    // 例外を補足する変数
    let captured: unknown;
    // Probe
    function Probe(): React.JSX.Element {
      // try で囲う
      try {
        // Provider 外で呼ぶ
        useAuthContext();
      } catch (error) {
        // 補足
        captured = error;
      }
      // 描画は空
      return <>{null}</>;
    }
    // 描画
    act(() => {
      // Provider なし
      create(<Probe />);
    });
    // Error 型であること
    expect(captured).toBeInstanceOf(Error);
    // メッセージに AuthProvider が含まれること
    expect((captured as Error).message).toMatch(/AuthProvider/);
  });

  // 匿名セッション時に useIsAuthenticated が false を返すこと
  it("匿名セッション時には useIsAuthenticated が false を返す", () => {
    // adapter（呼ばれない）
    const adapter: AuthAdapter = {
      // 匿名
      getSession: async () => ({ status: "anonymous", user: null }),
    };
    // manager（事前ロードしない）
    const manager = createAuthManager(adapter);
    // captured
    const captured: Partial<Record<string, unknown>> = {};
    // Probe
    function Probe(): React.JSX.Element {
      // 認証済みか
      captured.authenticated = useIsAuthenticated();
      // user
      captured.user = useCurrentUser();
      // 描画は空
      return <>{null}</>;
    }
    // 描画
    act(() => {
      // Provider
      create(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
    });
    // false であること
    expect(captured.authenticated).toBe(false);
    // user が null であること
    expect(captured.user).toBeNull();
  });
});
