// vitest の test/expect/describe を取り込み
import { describe, it, expect } from "vitest";
// 検証対象の defaultTheme を取り込み
import { defaultTheme } from "./theme.js";

// defaultTheme のハードコード値が意図せず変わらないことを保証するスナップショット的テスト
describe("defaultTheme", () => {
  // 色定義の主要値が固定されていること
  it("colors は仕様どおりの値である", () => {
    // 主要色は青系の #3366ff
    expect(defaultTheme.colors.primary).toBe("#3366ff");
    // 背景は白
    expect(defaultTheme.colors.background).toBe("#ffffff");
    // テキストは濃いグレー
    expect(defaultTheme.colors.text).toBe("#1a1a1a");
  });

  // スペーシングは 4 系列の倍数
  it("spacing は 4 系列の倍数である", () => {
    // 極小 4
    expect(defaultTheme.spacing.xs).toBe(4);
    // 小 8
    expect(defaultTheme.spacing.sm).toBe(8);
    // 中 16
    expect(defaultTheme.spacing.md).toBe(16);
    // 大 24
    expect(defaultTheme.spacing.lg).toBe(24);
    // 特大 32
    expect(defaultTheme.spacing.xl).toBe(32);
  });

  // タイポグラフィの規定値
  it("typography は OS 標準サンセリフ + 14px である", () => {
    // フォントファミリ
    expect(defaultTheme.typography.fontFamily).toBe("system-ui, sans-serif");
    // 基準サイズ
    expect(defaultTheme.typography.baseSize).toBe(14);
  });

  // colors トップキーが必須3つだけであることを確認（accent などが知らぬ間に増えていないか）
  it("colors の既定キーは primary/background/text の 3 つのみ", () => {
    // colors キーの並び順は問わずに集合一致を確認
    expect(Object.keys(defaultTheme.colors).sort()).toEqual(
      // 期待されるキー集合
      ["background", "primary", "text"],
    );
  });
});
