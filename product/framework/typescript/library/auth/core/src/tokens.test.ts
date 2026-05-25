// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象を取り込み
import {
  createAuthorizationHeader,
  createMemoryTokenStore,
  isTokenExpired,
  shouldRefreshToken,
} from "./tokens.js";

// TokenStore のテスト
describe("createMemoryTokenStore", () => {
  // get / set / clear が動くこと
  it("メモリ上でトークンを保存・取得・削除する", async () => {
    // 初期トークン付きで store を作る
    const store = createMemoryTokenStore({ accessToken: "a" });
    // 初期値を取得できること
    expect(await store.get()).toEqual({ accessToken: "a" });
    // 値を差し替える
    await store.set({ accessToken: "b", refreshToken: "r" });
    // 差し替え後の値を取得できること
    expect(await store.get()).toEqual({ accessToken: "b", refreshToken: "r" });
    // 値を削除する
    await store.clear();
    // 削除後は undefined であること
    expect(await store.get()).toBeUndefined();
  });
});

// トークン期限のテスト
describe("token expiry helpers", () => {
  // 期限切れを判定できること
  it("期限切れを判定する", () => {
    // 期限後なら true
    expect(isTokenExpired({ expiresAt: 1_000 }, 1_000)).toBe(true);
    // skew を含めて期限に達するなら true
    expect(isTokenExpired({ expiresAt: 1_100 }, 1_000, 100)).toBe(true);
    // 期限がなければ false
    expect(isTokenExpired({ accessToken: "a" }, 1_000)).toBe(false);
  });

  // 更新タイミングを判定できること
  it("更新すべきタイミングを判定する", () => {
    // window 内なら true
    expect(shouldRefreshToken({ expiresAt: 1_500 }, 1_000, 600)).toBe(true);
    // window 外なら false
    expect(shouldRefreshToken({ expiresAt: 2_000 }, 1_000, 600)).toBe(false);
    // 期限がなければ false
    expect(shouldRefreshToken(undefined, 1_000, 600)).toBe(false);
  });
});

// Authorization ヘッダ生成のテスト
describe("createAuthorizationHeader", () => {
  // Bearer 既定でヘッダ値を作ること
  it("Bearer ヘッダを作る", () => {
    // Bearer 形式で返ること
    expect(createAuthorizationHeader({ accessToken: "abc" })).toBe("Bearer abc");
  });

  // tokenType を反映すること
  it("tokenType を反映する", () => {
    // 指定スキームで返ること
    expect(createAuthorizationHeader({ accessToken: "abc", tokenType: "DPoP" })).toBe("DPoP abc");
  });

  // accessToken がない場合は undefined を返すこと
  it("accessToken がない場合は undefined を返す", () => {
    // undefined が返ること
    expect(createAuthorizationHeader({ refreshToken: "r" })).toBeUndefined();
  });
});
