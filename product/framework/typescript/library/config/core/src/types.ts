// 実行環境の種別を表すユニオン型
// dev: 開発環境、staging: 検証環境、prod: 本番環境
export type Env = "dev" | "staging" | "prod";

// すべてのアプリ共通で利用する基底コンフィグの型
// TFlags: feature flag の名前リテラル型、TTheme: テーマ型（既定は Theme）
export interface BaseConfig<
  // feature flag のキーとして許可する文字列リテラルの集合
  TFlags extends string = string,
  // テーマ型（Web/RN で異なる拡張を許容するためジェネリクス化）
  TTheme = unknown,
> {
  // 現在の実行環境
  env: Env;
  // 機能フラグのマップ（キー: フラグ名、値: 有効/無効）
  featureFlags: Record<TFlags, boolean>;
  // UI テーマ設定
  theme: TTheme;
}
