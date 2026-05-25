// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// バレル経由で全公開シンボルを取り込み（型は import type で型としてのみ参照）
import * as authCore from "./index.js";

// index.ts の公開 API 健全性検証
describe("auth/core public API surface", () => {
  // 公開関数群が import 可能で関数型であること
  it("公開関数を function として import できる", () => {
    // セッション関連
    expect(typeof authCore.createAnonymousSession).toBe("function");
    // セッション関連
    expect(typeof authCore.isAuthenticated).toBe("function");
    // セッション関連
    expect(typeof authCore.normalizeSession).toBe("function");
    // トークン関連
    expect(typeof authCore.createAuthorizationHeader).toBe("function");
    // トークン関連
    expect(typeof authCore.createMemoryTokenStore).toBe("function");
    // トークン関連
    expect(typeof authCore.isTokenExpired).toBe("function");
    // トークン関連
    expect(typeof authCore.shouldRefreshToken).toBe("function");
    // 権限関連
    expect(typeof authCore.canAccess).toBe("function");
    // 権限関連
    expect(typeof authCore.hasAllPermissions).toBe("function");
    // 権限関連
    expect(typeof authCore.hasAllRoles).toBe("function");
    // 権限関連
    expect(typeof authCore.hasAnyPermission).toBe("function");
    // 権限関連
    expect(typeof authCore.hasAnyRole).toBe("function");
    // 権限関連
    expect(typeof authCore.hasPermission).toBe("function");
    // 権限関連
    expect(typeof authCore.hasRole).toBe("function");
    // マネージャー
    expect(typeof authCore.createAuthManager).toBe("function");
  });

  // バレル経由でも作成・連携が完結すること（スモーク）
  it("バレル経由のシンボルだけで最小ユースケースを完遂できる", async () => {
    // 匿名セッションを作る
    const anonymous = authCore.createAnonymousSession();
    // 匿名は未認証
    expect(authCore.isAuthenticated(anonymous)).toBe(false);
    // メモリ TokenStore を作る
    const store = authCore.createMemoryTokenStore({ accessToken: "abc" });
    // 取得できること
    expect(await store.get()).toEqual({ accessToken: "abc" });
    // Authorization ヘッダを作れること
    expect(authCore.createAuthorizationHeader({ accessToken: "abc" })).toBe("Bearer abc");
    // 単純権限判定が呼び出せること
    expect(authCore.hasRole(null, "admin")).toBe(false);
    // 複合判定が allowed を返せること
    expect(
      authCore.canAccess(anonymous, { authenticated: false }).allowed,
    ).toBe(true);
  });
});
