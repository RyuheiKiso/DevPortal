// vitest の設定ヘルパを取り込み
import { defineConfig } from "vitest/config";

// vitest 実行設定
export default defineConfig({
  resolve: {
    alias: {
      "@k1s0-ts-outbox/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    // 対象は src 配下の test ファイル
    include: ["src/**/*.test.{ts,tsx}"],
    // React の act 警告抑制
    setupFiles: ["src/testSetup.ts"],
    // カバレッジ計測の設定
    coverage: {
      // v8 ネイティブカバレッジ
      provider: "v8",
      // ターミナル向け text と、ローカル確認用 html を出力
      reporter: ["text", "html"],
      // 計測対象は src 配下の TypeScript / TSX ファイル
      include: ["src/**/*.{ts,tsx}"],
      // 除外: テスト本体・re-export のみ
      exclude: [
        // テストコード自身
        "src/**/*.test.{ts,tsx}",
        // テストランナー設定
        "src/testSetup.ts",
        // re-export のみ
        "src/index.ts",
      ],
      // 閾値: いずれかが 100% を下回ったら CI で失敗させる
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
        autoUpdate: false,
      },
    },
  },
});
