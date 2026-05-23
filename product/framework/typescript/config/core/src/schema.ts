// zod を取り込み（runtime + 型生成の両方に使用）
import { z } from "zod";
// Theme 型を取り込み（themeSchema の戻り値型として参照）
import type { Theme } from "./theme.js";
// BaseConfig 型を取り込み（createConfigSchema の戻り値型として参照）
import type { BaseConfig } from "./types.js";

// Theme と整合する zod スキーマ
// colors は primary/background/text を必須、その他は string の追加プロパティを許容
export const themeSchema: z.ZodType<Theme> = z.object({
  // 色定義（必須3つ + 任意追加）
  colors: z
    .object({
      // 主要色
      primary: z.string(),
      // 背景色
      background: z.string(),
      // テキスト色
      text: z.string(),
    })
    // primary/background/text 以外の任意色を string として受け付ける
    .catchall(z.string()),
  // 余白スケール（すべて数値）
  spacing: z.object({
    // 極小
    xs: z.number(),
    // 小
    sm: z.number(),
    // 中
    md: z.number(),
    // 大
    lg: z.number(),
    // 特大
    xl: z.number(),
  }),
  // フォント関連
  typography: z.object({
    // フォントファミリ文字列
    fontFamily: z.string(),
    // 基準サイズ
    baseSize: z.number(),
  }),
});

// 実行環境 (Env) を表すスキーマ
const envSchema = z.enum(["dev", "staging", "prod"]);

// feature flag 名の配列から、対応する BaseConfig スキーマを生成する
// flagNames に指定したキーすべてに boolean が必須となるオブジェクトを構築
export function createConfigSchema<F extends string>(
  // 許可する feature flag のキー一覧
  flagNames: readonly F[],
): z.ZodType<BaseConfig<F, Theme>> {
  // 各フラグキーに z.boolean() を割り当ててオブジェクトスキーマを構築
  const flagsShape = Object.fromEntries(
    // 配列を [キー, スキーマ] のタプル列に変換
    flagNames.map((name) => [name, z.boolean()] as const),
  ) as Record<F, z.ZodBoolean>;
  // BaseConfig の各フィールドを束ねたスキーマ
  return z.object({
    // 実行環境
    env: envSchema,
    // 機能フラグマップ
    featureFlags: z.object(flagsShape),
    // テーマ
    theme: themeSchema,
  }) as unknown as z.ZodType<BaseConfig<F, Theme>>;
}

// 任意の値を任意のスキーマで検証して型を確定させる
// 失敗時は ZodError を投げる（呼び出し側で必要なら catch）
export function validateConfig<T>(
  // 検証に使う zod スキーマ
  schema: z.ZodType<T>,
  // 検証対象の値（外部由来など）
  input: unknown,
): T {
  // parse は失敗時に throw、成功時は T 型を返す
  return schema.parse(input);
}
