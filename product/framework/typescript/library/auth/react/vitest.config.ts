// vitest の設定ヘルパを取り込み（型補完と推論を効かせるため）
import { defineConfig } from "vitest/config";

// vitest 実行設定をエクスポート
export default defineConfig({
  // ローカル core ソースを参照してテストする
  resolve: {
    // パッケージ名の解決先を上書きする
    alias: {
      // auth core は sibling の src を直接参照する
      "@k1s0-ts-auth/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  // テストランナー本体に渡す設定群
  test: {
    // 対象ファイルパターン
    include: ["src/**/*.test.{ts,tsx}"],
    // カバレッジ計測の設定
    coverage: {
      // v8 ネイティブカバレッジ
      provider: "v8",
      // ターミナル向け text と、ローカル確認用 html を出力
      reporter: ["text", "html"],
      // 計測対象は src 配下の TypeScript / TSX ファイル
      include: ["src/**/*.{ts,tsx}"],
      // テスト本体と re-export は除外する
      exclude: ["src/**/*.test.{ts,tsx}", "src/index.ts"],
    },
  },
});
