// vitest の設定ヘルパを取り込み（型補完と推論を効かせるため）
import { defineConfig } from "vitest/config";

// vitest 実行設定をエクスポート
export default defineConfig({
  resolve: {
    alias: {
      "@k1s0-ts-notification/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  // テストランナー本体に渡す設定群
  test: {
    // 対象ファイルパターン（src 配下の *.test.ts(x) のみを実行）
    include: ["src/**/*.test.{ts,tsx}"],
    // 期待された React エラーログだけをテスト出力から除外
    setupFiles: ["src/testSetup.ts"],
    // カバレッジ計測の設定
    coverage: {
      // v8 ネイティブカバレッジ
      provider: "v8",
      // ターミナル向け text と、ローカル確認用 html を出力
      reporter: ["text", "html"],
      // 計測対象は src 配下の TypeScript / TSX ファイル
      include: ["src/**/*.{ts,tsx}"],
      // 除外: テスト本体、re-export のみの index、Context 定義のみのファイル
      exclude: [
        // テストコード自身
        "src/**/*.test.{ts,tsx}",
        // テストランナー設定
        "src/testSetup.ts",
        // 純粋な re-export
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
