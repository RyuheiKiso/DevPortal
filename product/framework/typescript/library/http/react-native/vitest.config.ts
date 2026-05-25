// vitest の設定ヘルパを取り込み（型補完と推論を効かせるため）
import { defineConfig } from "vitest/config";

// http react-native binding のテスト設定をエクスポート
export default defineConfig({
  // ローカル core ソースを参照してテストする
  resolve: {
    // パッケージ名の解決先を上書きする
    alias: {
      // http core は sibling の src を直接参照する（ローカル変更を即時検証するため）
      "@k1s0-ts-http/core": new URL("../core/src/index.ts", import.meta.url).pathname,
    },
  },
  // テストランナー本体に渡す設定群
  test: {
    // 対象ファイルパターン（src 配下の *.test.ts(x) のみを実行）
    include: ["src/**/*.test.{ts,tsx}"],
    // 注意: react-native の Platform.OS は require フックを vi.stubGlobal で差し替えてテストする
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
      // 閾値: いずれかが 100% を下回ったら CI で失敗させる（後退検知）
      thresholds: {
        // 全実行可能ステートメント
        statements: 100,
        // 分岐網羅
        branches: 100,
        // 関数網羅
        functions: 100,
        // 行網羅
        lines: 100,
        // 計測実値に応じて閾値を自動更新しない
        autoUpdate: false,
      },
    },
  },
});
