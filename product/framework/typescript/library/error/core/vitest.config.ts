// vitest の設定ヘルパーを読み込む
import { defineConfig } from "vitest/config";

// error core のテスト設定を公開する
export default defineConfig({
  // テストランナー設定
  test: {
    // core 配下の単体テストを対象にする
    include: ["src/**/*.test.ts"],
    // カバレッジ設定
    coverage: {
      // v8 coverage を使う
      provider: "v8",
      // console と HTML の両方を出す
      reporter: ["text", "html"],
      // src 配下の TypeScript 実装を対象にする
      include: ["src/**/*.ts"],
      // re-export と型だけのファイルは除外する
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/types.ts"],
      // 基盤パッケージとして現在の水準を維持する品質ゲートを置く
      thresholds: {
        // statements の下限
        statements: 95,
        // branches の下限
        branches: 90,
        // functions の下限
        functions: 100,
        // lines の下限
        lines: 95,
        // しきい値は手動で管理する
        autoUpdate: false,
      },
    },
  },
});
