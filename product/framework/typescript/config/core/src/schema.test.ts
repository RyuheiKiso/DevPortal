// vitest の test/expect/describe を取り込み
import { describe, it, expect } from "vitest";
// zod の ZodError を型として取り込み（throw 確認用）
import { ZodError } from "zod";
// テスト対象の関数とスキーマを取り込み
import { createConfigSchema, validateConfig, themeSchema } from "./schema.js";
// defaultTheme を使って合格ケースを構築
import { defaultTheme } from "./theme.js";

// themeSchema の挙動をテスト
describe("themeSchema", () => {
  // defaultTheme は themeSchema を通る
  it("defaultTheme を validate できる", () => {
    // 検証実行（throw しないこと）
    expect(() => validateConfig(themeSchema, defaultTheme)).not.toThrow();
  });

  // colors の追加プロパティ（catchall）も string なら許容
  it("colors に追加色フィールドがあっても許容する", () => {
    // accent を追加した拡張テーマ
    const extended = {
      ...defaultTheme,
      // 既存色 + accent を追加
      colors: { ...defaultTheme.colors, accent: "#ff0000" },
    };
    // 検証成功を期待
    expect(() => validateConfig(themeSchema, extended)).not.toThrow();
  });
});

// createConfigSchema + validateConfig の挙動をテスト
describe("createConfigSchema + validateConfig", () => {
  // 正しい入力は parse に成功する
  it("正しい BaseConfig を validate できる", () => {
    // 対応するスキーマを生成
    const schema = createConfigSchema(["newUi", "betaSearch"] as const);
    // 検証対象の設定
    const input = {
      // 環境
      env: "dev",
      // フラグマップ
      featureFlags: { newUi: true, betaSearch: false },
      // テーマ
      theme: defaultTheme,
    };
    // 検証成功を期待
    expect(() => validateConfig(schema, input)).not.toThrow();
  });

  // 不正な env 値は ZodError を投げる
  it("不正な env 値は ZodError を投げる", () => {
    // スキーマ
    const schema = createConfigSchema(["newUi"] as const);
    // env が enum 値以外
    const input = {
      // 不正な環境名
      env: "production",
      // フラグマップ
      featureFlags: { newUi: true },
      // テーマ
      theme: defaultTheme,
    };
    // ZodError を投げることを期待
    expect(() => validateConfig(schema, input)).toThrow(ZodError);
  });

  // 必須フラグが欠落していれば ZodError を投げる
  it("フラグが欠落していれば ZodError を投げる", () => {
    // newUi と betaSearch を要求
    const schema = createConfigSchema(["newUi", "betaSearch"] as const);
    // betaSearch が欠落
    const input = {
      // 環境
      env: "dev",
      // フラグマップ（不完全）
      featureFlags: { newUi: true },
      // テーマ
      theme: defaultTheme,
    };
    // ZodError を期待
    expect(() => validateConfig(schema, input)).toThrow(ZodError);
  });
});
