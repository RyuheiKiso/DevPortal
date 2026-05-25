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

  // 必須色（primary）が欠落した場合は ZodError を投げる
  it("colors.primary が欠落していれば ZodError を投げる", () => {
    // defaultTheme から primary を抜いたオブジェクトを構築
    const { primary: _omitted, ...restColors } = defaultTheme.colors;
    // primary なしの不正テーマ
    const invalid = { ...defaultTheme, colors: restColors };
    // 検証は ZodError を投げる
    expect(() => validateConfig(themeSchema, invalid)).toThrow(ZodError);
  });

  // 必須色（background）が欠落した場合も ZodError
  it("colors.background が欠落していれば ZodError を投げる", () => {
    // background を抜いた colors
    const { background: _omitted, ...restColors } = defaultTheme.colors;
    // 不正テーマ
    const invalid = { ...defaultTheme, colors: restColors };
    // ZodError を期待
    expect(() => validateConfig(themeSchema, invalid)).toThrow(ZodError);
  });

  // 必須色（text）が欠落した場合も ZodError
  it("colors.text が欠落していれば ZodError を投げる", () => {
    // text を抜いた colors
    const { text: _omitted, ...restColors } = defaultTheme.colors;
    // 不正テーマ
    const invalid = { ...defaultTheme, colors: restColors };
    // ZodError を期待
    expect(() => validateConfig(themeSchema, invalid)).toThrow(ZodError);
  });

  // colors の catchall に string 以外の値（number）を入れたら ZodError
  it("colors の追加プロパティが string 以外なら ZodError を投げる", () => {
    // accent に数値を割り当てた不正テーマ
    const invalid = {
      ...defaultTheme,
      // 数値を catchall に与える
      colors: { ...defaultTheme.colors, accent: 0xff0000 },
    };
    // ZodError を期待
    expect(() => validateConfig(themeSchema, invalid)).toThrow(ZodError);
  });

  // spacing の値が number 以外なら ZodError
  it("spacing.md が number 以外なら ZodError を投げる", () => {
    // md を文字列に置き換えた不正テーマ
    const invalid = {
      ...defaultTheme,
      // 数値であるべき md を文字列に
      spacing: { ...defaultTheme.spacing, md: "16" as unknown as number },
    };
    // ZodError を期待
    expect(() => validateConfig(themeSchema, invalid)).toThrow(ZodError);
  });

  // typography が欠落していれば ZodError
  it("typography が欠落していれば ZodError を投げる", () => {
    // typography プロパティを取り除いた不正テーマ
    const { typography: _omitted, ...rest } = defaultTheme;
    // typography なし
    const invalid = rest;
    // ZodError を期待
    expect(() => validateConfig(themeSchema, invalid)).toThrow(ZodError);
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

  // flagNames が空配列でも検証が通る（featureFlags は空オブジェクト）
  it("flagNames が空配列なら featureFlags 空オブジェクトを許容する", () => {
    // フラグ無しのスキーマを構築
    const schema = createConfigSchema([] as const);
    // featureFlags は空
    const input = {
      // 環境
      env: "dev",
      // 空のフラグマップ
      featureFlags: {},
      // テーマ
      theme: defaultTheme,
    };
    // 例外なく検証できる
    expect(() => validateConfig(schema, input)).not.toThrow();
  });

  // featureFlags に余剰キーがあると zod デフォルト strip により削除される
  it("featureFlags に余剰キーがあれば strip される", () => {
    // newUi のみを要求するスキーマ
    const schema = createConfigSchema(["newUi"] as const);
    // 余剰キー extra を含む入力
    const input = {
      // 環境
      env: "dev",
      // 余剰キー extra を含む
      featureFlags: { newUi: true, extra: true } as Record<string, boolean>,
      // テーマ
      theme: defaultTheme,
    };
    // 検証通過後の featureFlags から余剰キーが消えていることを確認
    const parsed = validateConfig(schema, input);
    // 結果に extra キーが存在しないこと
    expect(parsed.featureFlags).toEqual({ newUi: true });
  });

  // theme フィールドが不正なら ZodError を投げる（連鎖検証）
  it("theme が不正なら ZodError を投げる", () => {
    // スキーマ
    const schema = createConfigSchema(["newUi"] as const);
    // theme の spacing が欠落した不正入力
    const { spacing: _omitted, ...themeWithoutSpacing } = defaultTheme;
    // 不正入力
    const input = {
      // 環境
      env: "dev",
      // フラグマップ
      featureFlags: { newUi: true },
      // spacing が無い不完全なテーマ
      theme: themeWithoutSpacing,
    };
    // ZodError を期待
    expect(() => validateConfig(schema, input)).toThrow(ZodError);
  });
});
