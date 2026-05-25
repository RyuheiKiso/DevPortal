// vitest からテスト DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象モジュールを取り込み
import { LEVEL_RANK, LOG_LEVELS, compareLevel, shouldLog } from "./levels.js";
// LogLevel 型も取り込み
import type { LogLevel } from "./types.js";

// LOG_LEVELS と LEVEL_RANK の整合性を確認
describe("LOG_LEVELS / LEVEL_RANK", () => {
  // 配列の中身が想定順かを検証
  it("LOG_LEVELS が trace→fatal の順で並ぶ", () => {
    // 期待値と完全一致するか
    expect(LOG_LEVELS).toEqual(["trace", "debug", "info", "warn", "error", "fatal"]);
  });

  // 各レベルのランクが配列インデックスと一致するか
  it("LEVEL_RANK のランクが LOG_LEVELS のインデックスと一致する", () => {
    // 全レベルを舐めて検証
    LOG_LEVELS.forEach((lvl, idx) => {
      // ランクとインデックスの一致を確認
      expect(LEVEL_RANK[lvl]).toBe(idx);
    });
  });
});

// compareLevel の挙動を検証
describe("compareLevel", () => {
  // 同レベルでは 0 を返すこと
  it("同レベルでは 0 を返す", () => {
    // 任意のレベルで自己比較
    expect(compareLevel("info", "info")).toBe(0);
  });

  // 大→小（info > debug）で正の値を返すこと
  it("a が大きい場合に正の値を返す", () => {
    // 結果が 0 より大きいか
    expect(compareLevel("info", "debug")).toBeGreaterThan(0);
  });

  // 小→大（debug < info）で負の値を返すこと
  it("a が小さい場合に負の値を返す", () => {
    // 結果が 0 より小さいか
    expect(compareLevel("debug", "info")).toBeLessThan(0);
  });

  // 6 段階の総当たりで符号一貫性が保たれること
  it("全 LogLevel の総当たりで反対称性が保たれる", () => {
    // 二重ループで全組合せを検証
    for (const a of LOG_LEVELS) {
      for (const b of LOG_LEVELS) {
        // a-b と b-a が反対符号 or どちらも 0
        const ab = compareLevel(a, b);
        const ba = compareLevel(b, a);
        // 0 同士を ±0 で混同しないよう、sign の和が常に 0 になることを確認
        expect(Math.sign(ab) + Math.sign(ba)).toBe(0);
      }
    }
  });
});

// shouldLog の判定境界を確認
describe("shouldLog", () => {
  // 境界（同レベル）は通す
  it("entryLevel === minLevel は true", () => {
    // 同じレベル指定で true
    expect(shouldLog("info", "info")).toBe(true);
  });

  // 大きいレベルは通す
  it("entryLevel > minLevel は true", () => {
    // error は info を満たす
    expect(shouldLog("error", "info")).toBe(true);
  });

  // 小さいレベルは弾く
  it("entryLevel < minLevel は false", () => {
    // trace は info を満たさない
    expect(shouldLog("trace", "info")).toBe(false);
  });

  // 最低レベル trace を最大レベル fatal で弾く
  it("trace を fatal 最小で弾く", () => {
    // fatal 必須で trace は通らない
    expect(shouldLog("trace" satisfies LogLevel, "fatal")).toBe(false);
  });
});
