// zod を取り込み
import { z } from "zod";
// LogLevel を取り込み（型側の整合のため）
import type { LogLevel } from "./types.js";

// LogLevel を表すスキーマ（重要度順の enum）
export const logLevelSchema: z.ZodType<LogLevel> = z.enum([
  // 最小レベル
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  // 最大レベル
  "fatal",
]);

// Env を表すスキーマ
export const envSchema = z.enum(["dev", "staging", "prod"]);

// LoggerConfig のうち、データのみで構成されるフィールドの検証スキーマ
// transports は関数オブジェクトを持つため zod 対象外（型のみで保証）
export const loggerConfigSchema = z.object({
  // 実行環境（必須）
  env: envSchema,
  // 環境別最小レベル（任意）。値は LogLevel
  envLevels: z
    .object({
      // dev 環境の最小レベル
      dev: logLevelSchema.optional(),
      // staging 環境の最小レベル
      staging: logLevelSchema.optional(),
      // prod 環境の最小レベル
      prod: logLevelSchema.optional(),
    })
    .optional(),
  // フォールバック最小レベル（任意）
  defaultMinLevel: logLevelSchema.optional(),
  // 全エントリに付与するタグ（任意）
  tags: z.array(z.string()).optional(),
  // 全エントリに付与する構造化コンテキスト（任意）
  context: z.record(z.unknown()).optional(),
});

// loggerConfigSchema が表現する型（schema.parse の戻り値）
export type LoggerConfigInput = z.infer<typeof loggerConfigSchema>;

// 任意の値を loggerConfigSchema で検証する
// 失敗時は ZodError を投げる
export function validateLoggerConfig(input: unknown): LoggerConfigInput {
  // parse は失敗時に throw、成功時は型確定値を返す
  return loggerConfigSchema.parse(input);
}
