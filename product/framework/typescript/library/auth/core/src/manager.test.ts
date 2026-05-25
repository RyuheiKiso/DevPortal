// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象を取り込み
import { createAuthManager } from "./manager.js";
// 型を取り込み
import type { AuthAdapter, AuthSession } from "./types.js";

// 認証済みセッションを作る
function createSession(accessToken = "token-1"): AuthSession {
  // 認証済みセッションを返す
  return {
    // 認証済み状態
    status: "authenticated",
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
    tokens: { accessToken },
  };
}

// AuthManager のテスト
describe("createAuthManager", () => {
  // adapter.getSession で初期ロードできること
  it("adapter からセッションをロードする", async () => {
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager を作る
    const manager = createAuthManager(adapter);
    // セッションを取得する
    const session = await manager.getSession();
    // 認証済みになること
    expect(session.status).toBe("authenticated");
    // adapter が呼ばれること
    expect(adapter.getSession).toHaveBeenCalledTimes(1);
    // 2 回目はキャッシュされること
    await manager.getSession();
    // adapter が追加で呼ばれないこと
    expect(adapter.getSession).toHaveBeenCalledTimes(1);
  });

  // signIn / refresh / signOut が状態を更新すること
  it("signIn / refresh / signOut で状態を更新する", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // 現在セッション取得
      getSession: vi.fn(async () => ({ status: "anonymous", user: null })),
      // ログイン
      signIn: vi.fn(async () => createSession("signed-in")),
      // 更新
      refresh: vi.fn(async () => createSession("refreshed")),
      // ログアウト
      signOut: vi.fn(async () => undefined),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // イベント記録を用意する
    const events: string[] = [];
    // 購読する
    manager.subscribe((_session, event) => events.push(event));
    // ログインする
    await manager.signIn();
    // ログイン後トークンがヘッダに出ること
    expect(await manager.getAuthHeaders()).toEqual({ Authorization: "Bearer signed-in" });
    // 更新する
    await manager.refresh();
    // 更新後トークンがヘッダに出ること
    expect(await manager.getAccessToken()).toBe("refreshed");
    // ログアウトする
    await manager.signOut();
    // ログアウト後は匿名であること
    expect(manager.getSnapshot().status).toBe("anonymous");
    // イベント順が正しいこと
    expect(events).toEqual(["signedIn", "tokenRefreshed", "signedOut"]);
  });

  // 権限判定を現在セッションに対して行うこと
  it("現在セッションに対してロールと権限を判定する", async () => {
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager を作る
    const manager = createAuthManager(adapter);
    // ロードする
    await manager.getSession();
    // admin ロールを持つこと
    expect(manager.hasRole("admin")).toBe(true);
    // invoice:read 権限を持つこと
    expect(manager.hasPermission("invoice:read")).toBe(true);
    // 複合要件を満たすこと
    expect(manager.canAccess({ roles: ["admin"], permissions: ["invoice:read"] }).allowed).toBe(true);
  });
});
