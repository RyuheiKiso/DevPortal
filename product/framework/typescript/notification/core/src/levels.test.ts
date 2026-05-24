// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { NOTIFICATION_LEVELS, LEVEL_RANK, compareLevel, isHigherLevel } from "./levels.js";

describe("levels", () => {
  // 配列定義の順序が想定通りであることを確認
  it("NOTIFICATION_LEVELS は info -> success -> warning -> error の順", () => {
    expect(NOTIFICATION_LEVELS).toEqual(["info", "success", "warning", "error"]);
  });

  // LEVEL_RANK が順序通りの数値割り当てになっている
  it("LEVEL_RANK は重要度順に 0..3 を割り当てる", () => {
    expect(LEVEL_RANK.info).toBe(0);
    expect(LEVEL_RANK.success).toBe(1);
    expect(LEVEL_RANK.warning).toBe(2);
    expect(LEVEL_RANK.error).toBe(3);
  });

  // compareLevel の符号がランク差と一致する
  it("compareLevel はランク差を符号で返す", () => {
    // 大 - 小は正
    expect(compareLevel("error", "info")).toBeGreaterThan(0);
    // 同等は 0
    expect(compareLevel("warning", "warning")).toBe(0);
    // 小 - 大は負
    expect(compareLevel("info", "error")).toBeLessThan(0);
  });

  // isHigherLevel は a > b のときのみ true
  it("isHigherLevel は a の重要度が b より高ければ true", () => {
    // 高 > 低
    expect(isHigherLevel("error", "info")).toBe(true);
    // 同等
    expect(isHigherLevel("warning", "warning")).toBe(false);
    // 低 < 高
    expect(isHigherLevel("info", "warning")).toBe(false);
  });
});
