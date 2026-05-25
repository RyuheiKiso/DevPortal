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
// テスト対象を取り込み
import { RequireAuth } from "./RequireAuth.js";

// 認証済みセッションを返すヘルパ
function makeAuthSession(): AuthSession {
  // 認証済み AuthSession
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
  };
}

// 描画結果を JSON として一括取得するヘルパ
function renderToJson(ui: React.JSX.Element): string {
  // renderer を保持する変数
  let renderer: ReturnType<typeof create> | undefined;
  // 同期描画
  act(() => {
    // renderer を作る
    renderer = create(ui);
  });
  // JSON 化して返す
  return JSON.stringify(renderer?.toJSON());
}

// RequireAuth のテスト
describe("RequireAuth", () => {
  // 認証済みのとき children を表示すること
  it("認証済みのとき children を表示する", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 認証済みセッションを返す
      getSession: async () => makeAuthSession(),
    };
    // manager
    const manager = createAuthManager(adapter);
    // 事前ロード
    await manager.getSession();
    // 描画
    const json = renderToJson(
      // Provider 配下に RequireAuth を配置
      <AuthProvider manager={manager}>
        <RequireAuth fallback={<span>login</span>}>
          <span>private-area</span>
        </RequireAuth>
      </AuthProvider>,
    );
    // 認証済み領域が表示されること
    expect(json).toContain("private-area");
    // fallback は表示されないこと
    expect(json).not.toContain("login");
  });

  // 匿名のとき fallback を表示すること
  it("匿名のとき fallback を表示する", () => {
    // adapter（呼ばれないが必要）
    const adapter: AuthAdapter = {
      // 匿名セッションを返す
      getSession: async () => ({ status: "anonymous", user: null }),
    };
    // manager（事前ロードしない）
    const manager = createAuthManager(adapter);
    // 描画
    const json = renderToJson(
      // Provider
      <AuthProvider manager={manager}>
        <RequireAuth fallback={<span>login-required</span>}>
          <span>private-area</span>
        </RequireAuth>
      </AuthProvider>,
    );
    // fallback が表示されること
    expect(json).toContain("login-required");
    // children は表示されないこと
    expect(json).not.toContain("private-area");
  });

  // fallback 未指定でも例外にならず null を描画すること
  it("fallback 未指定では何も描画しない（throw しない）", () => {
    // adapter
    const adapter: AuthAdapter = {
      // 匿名セッション
      getSession: async () => ({ status: "anonymous", user: null }),
    };
    // manager
    const manager = createAuthManager(adapter);
    // 描画
    const json = renderToJson(
      // fallback 無し
      <AuthProvider manager={manager}>
        <RequireAuth>
          <span>private-area</span>
        </RequireAuth>
      </AuthProvider>,
    );
    // children は描画されないこと
    expect(json).not.toContain("private-area");
    // null（無描画）であること
    expect(json).toBe("null");
  });
});
