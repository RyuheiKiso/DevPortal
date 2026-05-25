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
import { RequirePermission } from "./RequirePermission.js";

// 認証済みセッションを返すヘルパ
function makeSession(roles: readonly string[], permissions: readonly string[]): AuthSession {
  // 認証済みを返す
  return {
    // 認証済み
    status: "authenticated",
    // ユーザー
    user: {
      // id
      id: "user-1",
      // ロール
      roles,
      // 権限
      permissions,
    },
  };
}

// 描画結果を JSON 文字列で取り出すヘルパ
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

// RequirePermission のテスト
describe("RequirePermission (react-native)", () => {
  // 認証済み + 必要権限を持つとき children を表示すること
  it("要件を満たすとき children を表示する", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 必要権限を持つ
      getSession: async () => makeSession(["admin"], ["invoice:read"]),
    };
    // manager
    const manager = createAuthManager(adapter);
    // 事前ロード
    await manager.getSession();
    // 描画
    const json = renderToJson(
      // 必要権限あり
      <AuthProvider manager={manager}>
        <RequirePermission requirement={{ permissions: ["invoice:read"] }} fallback={<>denied</>}>
          <>granted-area</>
        </RequirePermission>
      </AuthProvider>,
    );
    // children が描画される
    expect(json).toContain("granted-area");
    // fallback は描画されない
    expect(json).not.toContain("denied");
  });

  // 必要権限を持たないとき fallback を表示すること
  it("必要権限が不足するとき fallback を表示する", async () => {
    // adapter（権限不足）
    const adapter: AuthAdapter = {
      // 権限が無い
      getSession: async () => makeSession(["admin"], []),
    };
    // manager
    const manager = createAuthManager(adapter);
    // 事前ロード
    await manager.getSession();
    // 描画
    const json = renderToJson(
      // 不足する要件
      <AuthProvider manager={manager}>
        <RequirePermission
          requirement={{ permissions: ["invoice:read"] }}
          fallback={<>permission-denied</>}
        >
          <>granted-area</>
        </RequirePermission>
      </AuthProvider>,
    );
    // fallback が描画
    expect(json).toContain("permission-denied");
    // children は描画されない
    expect(json).not.toContain("granted-area");
  });

  // fallback 未指定では null を描画すること
  it("fallback 未指定では null を描画する", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 権限・ロール無し
      getSession: async () => makeSession([], []),
    };
    // manager
    const manager = createAuthManager(adapter);
    // 事前ロード
    await manager.getSession();
    // 描画
    const json = renderToJson(
      // fallback 省略
      <AuthProvider manager={manager}>
        <RequirePermission requirement={{ permissions: ["invoice:read"] }}>
          <>granted-area</>
        </RequirePermission>
      </AuthProvider>,
    );
    // children は描画されない
    expect(json).not.toContain("granted-area");
    // null
    expect(json).toBe("null");
  });
});
