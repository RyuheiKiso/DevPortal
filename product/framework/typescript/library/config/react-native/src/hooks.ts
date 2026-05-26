// React の useContext を取り込み
import { useContext } from "react";
// 基底コンフィグ型と Theme 型を core から取り込み
import type { BaseConfig, Theme } from "@k1s0-ts-config/core";
// 判定本体は core を再利用
import { isFeatureEnabled } from "@k1s0-ts-config/core";
// Context 本体
import { ConfigContext } from "./context.js";

// Provider から渡された設定を取得する hook
// Provider 外で呼ばれた場合は Error を投げる
export function useConfig<T extends BaseConfig = BaseConfig>(): T {
  // 現在の Context 値を取得
  const value = useContext(ConfigContext);
  // Provider 配下でなければエラー
  if (value === null) {
    // エラーメッセージで Provider のラップを促す
    throw new Error(
      "useConfig must be called inside <ConfigProvider>. Wrap your tree with <ConfigProvider config={...}>.",
    );
  }
  // 呼び出し側ジェネリクスでキャストして返す
  return value as T;
}

// 指定フラグの有効/無効を返す薄いラッパー hook
//
// 型安全性: F のジェネリクスでフラグ名を絞り込めるようにする。
// 例: `useFeatureFlag<"newUi" | "betaSearch">("newUi")` でタイプミスをコンパイル時に検出。
// 既存呼び出し（`useFeatureFlag("foo")`）は F = string がデフォルトのため非破壊。
export function useFeatureFlag<F extends string = string>(
  // 判定対象のフラグ名
  name: F,
): boolean {
  // 現在の設定を取得
  const config = useConfig();
  // core の判定関数に委譲
  return isFeatureEnabled(
    // 型を緩めて渡す
    config.featureFlags as Record<string, boolean>,
    name,
  );
}

// テーマを取り出す hook
//
// 注意: 戻り値は as Theme で強制キャストしている（ランタイム検証は行わない）。
// 利用側は ConfigProvider に渡す前に `themeSchema.parse(theme)` で必ず検証しておくこと。
// 検証せずに不正な theme を Provider に渡すと、useTheme 経由のプロパティアクセスで
// undefined エラーになる。
export function useTheme(): Theme {
  // 現在の設定を取得
  const config = useConfig();
  // Theme 型にキャストして返す
  return config.theme as Theme;
}
