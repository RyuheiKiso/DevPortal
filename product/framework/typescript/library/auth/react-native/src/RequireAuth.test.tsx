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
  // 認証済みセッション
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

// JSON 文字列で描画結果を取り出すヘルパ
function renderToJson(ui: React.JSX.Element): string {
  // renderer
  let renderer: ReturnType<typeof create> | undefined;
  // 描画
  act(() => {
    // renderer を作る
    renderer = create(ui);
  });
  // JSON 化
  return JSON.stringify(renderer?.toJSON());
}

// RequireAuth のテスト
describe("RequireAuth (react-native)", () => {
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
      // Provider 配下
      <AuthProvider manager={manager}>
        <RequireAuth fallback={<>login</>}>
          <>private-area</>
        </RequireAuth>
      </AuthProvider>,
    );
    // 認証済み領域が描画されていること
    expect(json).toContain("private-area");
    // fallback は描画されないこと
    expect(json).not.toContain("login");
  });

  // 匿名のとき fallback を表示すること
  it("匿名のとき fallback を表示する", () => {
    // adapter（匿名を返す）
    const adapter: AuthAdapter = {
      // 匿名
      getSession: async () => ({ status: "anonymous", user: null }),
    };
    // manager（事前ロードしない）
    const manager = createAuthManager(adapter);
    // 描画
    const json = renderToJson(
      // Provider 配下
      <AuthProvider manager={manager}>
        <RequireAuth fallback={<>login-required</>}>
          <>private-area</>
        </RequireAuth>
      </AuthProvider>,
    );
    // fallback が描画
    expect(json).toContain("login-required");
    // children は描画されない
    expect(json).not.toContain("private-area");
  });

  // fallback 未指定でも null を返すこと
  it("fallback 未指定では null を描画する（throw しない）", () => {
    // adapter
    const adapter: AuthAdapter = {
      // 匿名
      getSession: async () => ({ status: "anonymous", user: null }),
    };
    // manager
    const manager = createAuthManager(adapter);
    // 描画
    const json = renderToJson(
      // fallback 省略
      <AuthProvider manager={manager}>
        <RequireAuth>
          <>private-area</>
        </RequireAuth>
      </AuthProvider>,
    );
    // children は描画されない
    expect(json).not.toContain("private-area");
    // null になっていること
    expect(json).toBe("null");
  });
});
