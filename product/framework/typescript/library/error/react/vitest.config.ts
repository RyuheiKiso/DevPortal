// vitest の設定ヘルパを取り込み
import { defineConfig } from "vitest/config";

// error react binding のテスト設定をエクスポート
export default defineConfig({
  // sibling の core 実装を直接参照してローカル変更を即時検証する
  resolve: {
    // package 名解決を src に差し替える
    alias: {
      // error core の公開 entry を参照する
      "@k1s0-ts-error/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  // テストランナー本体に渡す設定群
  test: {
    // 対象は src 配下の test ファイル（.ts と .tsx 両方）
    include: ["src/**/*.test.{ts,tsx}"],
    // React 19 の act 環境フラグと既知の boundary ノイズを抑制する setup
    setupFiles: ["src/testSetup.ts"],
    // カバレッジ計測の設定
    coverage: {
      // v8 ネイティブカバレッジ
      provider: "v8",
      // ターミナル向け text と、ローカル確認用 html を出力
      reporter: ["text", "html"],
      // 計測対象は src 配下の TypeScript / TSX ファイル
      include: ["src/**/*.{ts,tsx}"],
      // 除外: テスト本体、setupFiles、re-export のみの index
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
