// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象を取り込み
import { authTokenSetSchema } from "./schema.js";

// authTokenSetSchema の網羅テスト
describe("authTokenSetSchema", () => {
  // 空オブジェクトは valid (全フィールド optional)
  it("空オブジェクトを受け入れる", () => {
    // safeParse は success: true を返す
    const result = authTokenSetSchema.safeParse({});
    // 検証成功を確認
    expect(result.success).toBe(true);
  });

  // 全フィールド指定 valid
  it("全フィールド指定を受け入れる", () => {
    // 全フィールド埋めたペイロード
    const payload = {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 1700000000000,
      tokenType: "Bearer",
      scope: "read write",
    };
    // 検証
    const result = authTokenSetSchema.safeParse(payload);
    // 成功と data 一致を確認
    expect(result.success).toBe(true);
    if (result.success) {
      // 中身が型通りであること
      expect(result.data).toEqual(payload);
    }
  });

  // 型不一致は invalid
  it("型不一致のフィールドを拒否する", () => {
    // accessToken に数値を渡す (string であるべき)
    const result = authTokenSetSchema.safeParse({ accessToken: 123 });
    // 検証失敗を確認
    expect(result.success).toBe(false);
  });

  // 余剰フィールドは strict で拒否
  it("余剰フィールドを拒否する (strict)", () => {
    // schema 定義外の extraField を含むペイロード
    const result = authTokenSetSchema.safeParse({
      accessToken: "a",
      extraField: "should-not-be-here",
    });
    // strict mode により拒否されること
    expect(result.success).toBe(false);
  });

  // 非オブジェクト入力は invalid
  it("非オブジェクト入力を拒否する", () => {
    // 文字列を渡す
    expect(authTokenSetSchema.safeParse("string").success).toBe(false);
    // 配列を渡す
    expect(authTokenSetSchema.safeParse([]).success).toBe(false);
    // null を渡す
    expect(authTokenSetSchema.safeParse(null).success).toBe(false);
  });
});
