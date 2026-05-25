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
  // 認証済み AuthSession
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

// 描画結果を JSON として一括取得するヘルパ
function renderToJson(ui: React.JSX.Element): string {
  // renderer
  let renderer: ReturnType<typeof create> | undefined;
  // 描画
  act(() => {
    // renderer を作る
    renderer = create(ui);
  });
  // JSON 化して返す
  return JSON.stringify(renderer?.toJSON());
}

// RequirePermission のテスト
describe("RequirePermission", () => {
  // 認証済み + 必要権限を持つとき children を表示すること
  it("要件を満たすとき children を表示する", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 認証済みセッションを返す
      getSession: async () => makeSession(["admin"], ["invoice:read", "invoice:write"]),
    };
    // manager
    const manager = createAuthManager(adapter);
    // 事前ロード
    await manager.getSession();
    // 描画
    const json = renderToJson(
      // 必要権限あり
      <AuthProvider manager={manager}>
        <RequirePermission requirement={{ permissions: ["invoice:read"] }} fallback={<span>denied</span>}>
          <span>granted-area</span>
        </RequirePermission>
      </AuthProvider>,
    );
    // children が表示されること
    expect(json).toContain("granted-area");
    // fallback は表示されないこと
    expect(json).not.toContain("denied");
  });

  // 必要権限が不足するとき fallback を表示すること
  it("不足する権限要件のとき fallback を表示する", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 一部の権限のみ
      getSession: async () => makeSession(["admin"], ["invoice:read"]),
    };
    // manager
    const manager = createAuthManager(adapter);
    // 事前ロード
    await manager.getSession();
    // 描画
    const json = renderToJson(
      // 不足する権限を要求
      <AuthProvider manager={manager}>
        <RequirePermission
          requirement={{ permissions: ["invoice:delete"] }}
          fallback={<span>permission-denied</span>}
        >
          <span>granted-area</span>
        </RequirePermission>
      </AuthProvider>,
    );
    // fallback が表示されること
    expect(json).toContain("permission-denied");
    // children は表示されないこと
    expect(json).not.toContain("granted-area");
  });

  // role 要件と any モードで一致するときは children を表示すること
  it("any モードでロールまたは権限のいずれかが一致すれば children を表示する", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // ロールのみ持つ
      getSession: async () => makeSession(["operator"], []),
    };
    // manager
    const manager = createAuthManager(adapter);
    // 事前ロード
    await manager.getSession();
    // 描画
    const json = renderToJson(
      // operator ロールで any モード
      <AuthProvider manager={manager}>
        <RequirePermission
          requirement={{ mode: "any", roles: ["admin", "operator"], permissions: ["invoice:delete"] }}
          fallback={<span>denied</span>}
        >
          <span>granted</span>
        </RequirePermission>
      </AuthProvider>,
    );
    // children が表示されること
    expect(json).toContain("granted");
  });

  // fallback 未指定では何も描画しないこと
  it("fallback 未指定では何も描画しない", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 権限不足
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
          <span>granted-area</span>
        </RequirePermission>
      </AuthProvider>,
    );
    // children は表示されない
    expect(json).not.toContain("granted-area");
    // null になっていること
    expect(json).toBe("null");
  });
});
