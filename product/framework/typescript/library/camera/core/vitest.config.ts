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
      // v8 ネイティブカバレッジを利用（istanbul より低オーバーヘッド）
      provider: "v8",
      // ターミナル向け text と、ローカル確認用 html を出力
      reporter: ["text", "html"],
      // 計測対象は src 配下の TypeScript ファイル
      include: ["src/**/*.ts"],
      // 除外: テスト本体、型定義のみのファイル、re-export のみの index
      exclude: [
        // テストコード自身はカバレッジ対象外
        "src/**/*.test.ts",
        // 型エイリアス／インターフェースのみで JS コードが生成されない
        "src/types.ts",
        // CameraAdapter は型定義のみのファイル（JS コードが生成されない）
        "src/adapter.ts",
        // 純粋な re-export のみのバレル
        "src/index.ts",
      ],
      // 閾値: いずれかが 100% を下回ったら CI で失敗させる
      thresholds: {
        // 全実行可能ステートメント
        statements: 100,
        // 分岐網羅
        branches: 100,
        // 関数網羅
        functions: 100,
        // 行網羅
        lines: 100,
        // 計測実値に応じて閾値を自動更新しない（後退検知のため）
        autoUpdate: false,
      },
    },
  },
});
