// 型定義（Env, BaseConfig）を公開
export type { Env, BaseConfig } from "./types.js";

// 環境マージ機能を公開（関数本体と関連型）
export { mergeEnvConfig } from "./env.js";
export type { EnvConfigMap } from "./env.js";

// 機能フラグユーティリティを公開
export { isFeatureEnabled, withOverrides } from "./featureFlags.js";

// テーマ型と既定値を公開
export type { Theme } from "./theme.js";
export { defaultTheme } from "./theme.js";

// zod スキーマと validation ヘルパを公開
export { themeSchema, createConfigSchema, validateConfig } from "./schema.js";
