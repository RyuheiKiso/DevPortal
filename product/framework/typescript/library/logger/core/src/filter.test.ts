// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { createLevelFilter, resolveMinLevel } from "./filter.js";
// 型を取り込み
import type { LogEntry } from "./types.js";

// resolveMinLevel の解決ロジック
describe("resolveMinLevel", () => {
  // envLevels で当該 env が指定されていればそれを返す
  it("envLevels に env がある場合はその値を返す", () => {
    // dev に debug を指定
    expect(resolveMinLevel("dev", { dev: "debug" })).toBe("debug");
  });

  // envLevels に env が無いときは fallback を返す
  it("envLevels に env が無い場合は fallback を返す", () => {
    // prod は未指定、fallback として warn を渡す
    expect(resolveMinLevel("prod", { dev: "debug" }, "warn")).toBe("warn");
  });

  // envLevels も fallback も無いと既定 info を返す
  it("envLevels も fallback も無い場合は既定 info", () => {
    // 引数を最小限で呼び出し
    expect(resolveMinLevel("dev")).toBe("info");
  });
});

// createLevelFilter による predicate の判定
describe("createLevelFilter", () => {
  // dev に debug を設定すると info / debug が通る
  it("dev / debug 設定で debug と info が通り trace は弾かれる", () => {
    // フィルタ生成
    const passes = createLevelFilter({ env: "dev", envLevels: { dev: "debug" } });
    // info は通る
    expect(passes({ level: "info", message: "", timestamp: 0 } as LogEntry)).toBe(true);
    // debug は通る（境界）
    expect(passes({ level: "debug", message: "", timestamp: 0 } as LogEntry)).toBe(true);
    // trace は弾かれる
    expect(passes({ level: "trace", message: "", timestamp: 0 } as LogEntry)).toBe(false);
  });

  // prod に warn を設定すると warn 以下が通る
  it("prod / warn 設定で warn 以下を通し info を弾く", () => {
    // フィルタ生成
    const passes = createLevelFilter({ env: "prod", envLevels: { prod: "warn" } });
    // info は弾かれる
    expect(passes({ level: "info", message: "", timestamp: 0 } as LogEntry)).toBe(false);
    // warn は通る（境界）
    expect(passes({ level: "warn", message: "", timestamp: 0 } as LogEntry)).toBe(true);
    // fatal は通る
    expect(passes({ level: "fatal", message: "", timestamp: 0 } as LogEntry)).toBe(true);
  });

  // envLevels 未指定でも defaultMinLevel が効く
  it("defaultMinLevel が効く", () => {
    // 既定を error にして info を弾く
    const passes = createLevelFilter({ env: "dev", defaultMinLevel: "error" });
    // info は弾かれる
    expect(passes({ level: "info", message: "", timestamp: 0 } as LogEntry)).toBe(false);
    // error は通る
    expect(passes({ level: "error", message: "", timestamp: 0 } as LogEntry)).toBe(true);
  });
});
