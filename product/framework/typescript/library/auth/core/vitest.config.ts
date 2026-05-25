// vitest の設定ヘルパを取り込み（型補完と推論を効かせるため）
import { defineConfig } from "vitest/config";

// vitest 実行設定をエクスポート
export default defineConfig({
  // テストランナー本体に渡す設定群
  test: {
    // 対象ファイルパターン（src 配下の *.test.ts のみを実行）
    include: ["src/**/*.test.ts"],
    // カバレッジ計測の設定
    coverage: {
      // v8 ネイティブカバレッジを利用
      provider: "v8",
      // ターミナル向け text と、ローカル確認用 html を出力
      reporter: ["text", "html"],
      // 計測対象は src 配下の TypeScript ファイル
      include: ["src/**/*.ts"],
      // 除外: テスト本体、型定義のみのファイル、re-export のみの index
      exclude: ["src/**/*.test.ts", "src/types.ts", "src/index.ts"],
    },
  },
});
