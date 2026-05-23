// vitest の test/expect/describe を取り込み
import { describe, it, expect } from "vitest";
// テスト対象の関数を取り込み
import { isFeatureEnabled, withOverrides } from "./featureFlags.js";

// isFeatureEnabled の挙動をテスト
describe("isFeatureEnabled", () => {
  // true の場合に true を返す
  it("フラグが true なら true を返す", () => {
    // フラグマップ
    const flags = { newUi: true, betaSearch: false };
    // 有効フラグを判定
    expect(isFeatureEnabled(flags, "newUi")).toBe(true);
  });

  // false の場合に false を返す
  it("フラグが false なら false を返す", () => {
    // フラグマップ
    const flags = { newUi: true, betaSearch: false };
    // 無効フラグを判定
    expect(isFeatureEnabled(flags, "betaSearch")).toBe(false);
  });
});

// withOverrides の挙動をテスト
describe("withOverrides", () => {
  // 上書きが正しくマージされる
  it("ベースに上書きを浅くマージする", () => {
    // ベースフラグ
    const base = { newUi: false, betaSearch: true };
    // 一部だけ上書き
    const result = withOverrides(base, { newUi: true });
    // newUi は上書き、betaSearch はベースのまま
    expect(result).toEqual({ newUi: true, betaSearch: true });
  });

  // 元のオブジェクトは変更されない（イミュータブル）
  it("元の base オブジェクトを変更しない", () => {
    // ベースフラグ
    const base = { newUi: false, betaSearch: true };
    // 上書きを適用
    withOverrides(base, { newUi: true });
    // base は元のまま
    expect(base).toEqual({ newUi: false, betaSearch: true });
  });

  // overrides が空でもベースのコピーが返る
  it("overrides が空ならベースと等価なコピーを返す", () => {
    // ベースフラグ
    const base = { newUi: true };
    // 空の上書き
    const result = withOverrides(base, {});
    // ベースと等価
    expect(result).toEqual(base);
    // しかし別参照
    expect(result).not.toBe(base);
  });
});
