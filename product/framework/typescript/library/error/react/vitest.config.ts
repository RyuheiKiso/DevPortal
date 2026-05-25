// vitest の設定ヘルパーを読み込む
import { defineConfig } from "vitest/config";

// error react binding のテスト設定を公開する
export default defineConfig({
  // sibling の core 実装を直接参照してローカル変更を検証する
  resolve: {
    // package 名解決を src に差し替える
    alias: {
      // error core の公開 entry を参照する
      "@k1s0-ts-error/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  // テストランナー設定
  test: {
    // TypeScript / TSX のテストを対象にする
    include: ["src/**/*.test.{ts,tsx}"],
    // カバレッジ設定
    coverage: {
      // v8 coverage を使う
      provider: "v8",
      // console と HTML の両方を出す
      reporter: ["text", "html"],
      // src 配下の実装を対象にする
      include: ["src/**/*.{ts,tsx}"],
      // re-export とテストは除外する
      exclude: ["src/**/*.test.{ts,tsx}", "src/index.ts"],
      // 基盤パッケージとして現在の水準を維持する品質ゲートを置く
      thresholds: {
        // statements の下限
        statements: 90,
        // branches の下限
        branches: 80,
        // functions の下限
        functions: 90,
        // lines の下限
        lines: 95,
        // しきい値は手動で管理する
        autoUpdate: false,
      },
    },
  },
});
