// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// React を取り込み
import * as React from "react";
// react-test-renderer を取り込み
import { act, create } from "react-test-renderer";
// core から manager 生成を取り込み
import { createAuthManager } from "@k1s0-ts-auth/core";
// core から型を取り込み
import type { AuthAdapter } from "@k1s0-ts-auth/core";
// Provider を取り込み
import { AuthProvider } from "./AuthProvider.js";
// 表示ガードを取り込み
import { RequireAuth } from "./RequireAuth.js";
// 表示ガードを取り込み
import { RequirePermission } from "./RequirePermission.js";
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

// 認証済み adapter を作る
function createAdapter(): AuthAdapter {
  // adapter 契約を返す
  return {
    // 現在セッションを返す
    async getSession() {
      // 認証済みセッションを返す
      return {
        // 認証済み状態
        status: "authenticated" as const,
        // ユーザー情報
        user: {
          // ユーザー ID
          id: "user-1",
          // ロール一覧
          roles: ["admin"],
          // 権限一覧
          permissions: ["invoice:read"],
        },
        // トークン集合
        tokens: { accessToken: "token-1" },
      };
    },
  };
}

// React hook のテスト
describe("auth react hooks", () => {
  // Provider 配下で hooks が値を返すこと
  it("Provider 配下で認証状態と権限を取得する", async () => {
    // manager を作る
    const manager = createAuthManager(createAdapter());
    // 事前にロードする
    await manager.getSession();
    // captured を用意する
    const captured: Partial<Record<string, unknown>> = {};
    // Probe コンポーネントを定義する
    function Probe(): React.JSX.Element {
      // ユーザーを取得する
      captured.user = useCurrentUser();
      // 認証済みかを取得する
      captured.authenticated = useIsAuthenticated();
      // admin ロールを取得する
      captured.admin = useRole("admin");
      // invoice:read 権限を取得する
      captured.read = usePermission("invoice:read");
      // 描画内容は空にする
      return <>{null}</>;
    }
    // React ツリーを描画する
    act(() => {
      // Provider 配下に Probe を配置する
      create(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
    });
    // ユーザー ID が取得できること
    expect(captured.user).toMatchObject({ id: "user-1" });
    // 認証済みであること
    expect(captured.authenticated).toBe(true);
    // admin ロールを持つこと
    expect(captured.admin).toBe(true);
    // invoice:read 権限を持つこと
    expect(captured.read).toBe(true);
  });

  // 表示ガードが children / fallback を切り替えること
  it("RequireAuth と RequirePermission が表示を切り替える", async () => {
    // manager を作る
    const manager = createAuthManager(createAdapter());
    // 事前にロードする
    await manager.getSession();
    // renderer を保持する
    let renderer: ReturnType<typeof create> | undefined;
    // React ツリーを描画する
    act(() => {
      // Provider 配下に表示ガードを配置する
      renderer = create(
        <AuthProvider manager={manager}>
          <RequireAuth fallback={<span>login</span>}>
            <span>private</span>
          </RequireAuth>
          <RequirePermission requirement={{ permissions: ["invoice:delete"] }} fallback={<span>denied</span>}>
            <span>delete</span>
          </RequirePermission>
        </AuthProvider>,
      );
    });
    // JSON 化して確認する
    const json = renderer?.toJSON();
    // 認証済み領域は表示されること
    expect(JSON.stringify(json)).toContain("private");
    // 不足権限領域は fallback になること
    expect(JSON.stringify(json)).toContain("denied");
  });

  // manager の購読変化が反映されること
  it("manager のセッション変化を反映する", async () => {
    // manager を作る
    const manager = createAuthManager(createAdapter());
    // adapter spy を置く
    const listener = vi.fn();
    // 購読する
    manager.subscribe(listener);
    // セッションを差し替える
    await manager.setSession({ status: "anonymous", user: null });
    // 通知されること
    expect(listener).toHaveBeenCalled();
  });

  // useAuth / useAuthSession / useAuthContext / useAccess を一通り呼べること
  it("Provider 配下で各種 hook が manager と整合した値を返す", async () => {
    // manager を作る
    const manager = createAuthManager(createAdapter());
    // 事前ロード
    await manager.getSession();
    // captured
    const captured: Partial<Record<string, unknown>> = {};
    // Probe
    function Probe(): React.JSX.Element {
      // Context 全体
      const ctx = useAuthContext();
      // captured に詰める
      captured.manager = useAuth();
      // session
      captured.session = useAuthSession();
      // access decision
      captured.access = useAccess({ roles: ["admin"] });
      // 同 ctx の manager と一致すること（参照同一性）
      captured.sameManager = ctx.manager === captured.manager;
      // 描画は空
      return <>{null}</>;
    }
    // 描画する
    act(() => {
      // Provider 配下
      create(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
    });
    // manager が同一参照であること
    expect(captured.sameManager).toBe(true);
    // session が認証済みであること
    expect((captured.session as { status: string }).status).toBe("authenticated");
    // access が allowed=true であること
    expect((captured.access as { allowed: boolean }).allowed).toBe(true);
  });

  // Provider 外で hook を呼ぶと例外になること（ensureContext のエラー分岐）
  it("Provider 外で useAuthContext を呼ぶと明示エラー", () => {
    // 例外を補足する Probe
    let captured: unknown;
    // Probe コンポーネント
    function Probe(): React.JSX.Element {
      // try で囲って中身を補足
      try {
        // Provider 外で呼ぶ
        useAuthContext();
      } catch (error) {
        // 補足する
        captured = error;
      }
      // 描画は空
      return <>{null}</>;
    }
    // 描画する
    act(() => {
      // Provider なしで Probe を配置
      create(<Probe />);
    });
    // Error 型であること
    expect(captured).toBeInstanceOf(Error);
    // メッセージが想定通りであること
    expect((captured as Error).message).toMatch(/AuthProvider/);
  });
});
