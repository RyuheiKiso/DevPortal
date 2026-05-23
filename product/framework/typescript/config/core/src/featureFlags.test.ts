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

  // 仕様コメントの「未定義キーは false 扱い」を直接保証する
  it("flags に存在しないキーを引いた場合は false を返す", () => {
    // 既知キーのみのフラグマップ（newUi のみ）
    const flags = { newUi: true };
    // 型システムを通すために unknown 経由のキャストでテスト用の追加キーを引く
    const result = isFeatureEnabled(
      // 未定義キー名 unknownFlag を許容するキャスト
      flags as unknown as Record<"newUi" | "unknownFlag", boolean>,
      // 実体には存在しないキーを指定
      "unknownFlag",
    );
    // undefined === true は false なので false を返す
    expect(result).toBe(false);
  });

  // === true 比較で truthy 値（1 や "yes"）が誤って有効と判定されないことを保証
  it("値が true 以外の truthy 値（数値の 1）でも false を返す", () => {
    // boolean に整数 1 を強制的に格納したフラグマップ
    const flags = { newUi: 1 as unknown as boolean };
    // === true 比較が効いて false に倒れることを期待
    expect(isFeatureEnabled(flags, "newUi")).toBe(false);
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
