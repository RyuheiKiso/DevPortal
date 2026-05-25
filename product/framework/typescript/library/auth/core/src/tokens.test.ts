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

  // 引数なしで未保存状態として開始すること
  it("初期トークン未指定では未保存状態として開始する", async () => {
    // 引数なし
    const store = createMemoryTokenStore();
    // 取得は undefined
    expect(await store.get()).toBeUndefined();
    // 保存できる
    await store.set({ accessToken: "x" });
    // 取得できる
    expect(await store.get()).toEqual({ accessToken: "x" });
  });

  // 取得時にコピーを返し、外部 mutation で内部状態が壊れないこと
  it("取得時にコピーを返し、呼び出し側の mutation で内部状態が壊れない", async () => {
    // 初期値付き
    const store = createMemoryTokenStore({ accessToken: "a", refreshToken: "r" });
    // 値を取り出す
    const snapshot = await store.get();
    // 取得した値を mutate する
    if (snapshot !== undefined) snapshot.accessToken = "hacked";
    // 再取得しても元の値が保たれていること
    expect((await store.get())?.accessToken).toBe("a");
  });

  // set もコピーで内部に保持し、外部 mutation で壊れないこと
  it("set 時にコピーで保持し、呼び出し側の mutation で壊れない", async () => {
    // 空 store
    const store = createMemoryTokenStore();
    // 外から保持する参照
    const passed = { accessToken: "z" };
    // set する
    await store.set(passed);
    // 元参照を変更する
    passed.accessToken = "tampered";
    // 内部の値は影響を受けないこと
    expect((await store.get())?.accessToken).toBe("z");
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

  // tokens 自体が undefined なら false を返すこと
  it("tokens が undefined なら期限切れではないと扱う", () => {
    // undefined を渡す
    expect(isTokenExpired(undefined)).toBe(false);
  });

  // 既定 nowMs / skewMs で呼べること（Date.now ベース）
  it("引数省略でも nowMs と skewMs の既定値で動作する", () => {
    // 既知の十分過去の期限を渡せば true
    expect(isTokenExpired({ expiresAt: 0 })).toBe(true);
    // 既知の十分未来の期限を渡せば false
    expect(isTokenExpired({ expiresAt: Date.now() + 60_000 })).toBe(false);
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

  // windowMs 既定値（60_000）の境界動作
  it("shouldRefreshToken は windowMs 既定値で動作する", () => {
    // 期限まで 30 秒の場合は既定 window 60_000 で更新対象
    expect(shouldRefreshToken({ expiresAt: Date.now() + 30_000 })).toBe(true);
    // 期限まで 120 秒なら更新不要
    expect(shouldRefreshToken({ expiresAt: Date.now() + 120_000 })).toBe(false);
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

  // tokens 自体が undefined の場合も undefined を返すこと
  it("tokens 自体が undefined のときも undefined を返す", () => {
    // undefined が返ること
    expect(createAuthorizationHeader(undefined)).toBeUndefined();
  });

  // accessToken が空文字の場合も undefined を返すこと（仕様: 空は無効）
  it("accessToken が空文字なら undefined を返す", () => {
    // 空文字
    expect(createAuthorizationHeader({ accessToken: "" })).toBeUndefined();
  });
});
