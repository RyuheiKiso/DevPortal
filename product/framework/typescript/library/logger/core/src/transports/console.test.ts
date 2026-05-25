// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { createConsoleTransport } from "./console.js";
// 型を取り込み
import type { LogEntry } from "../types.js";

// 各レベルでテストするための仮 LogEntry を生成
function entry(level: LogEntry["level"], extra: Partial<LogEntry> = {}): LogEntry {
  // 最小限のフィールドを埋めて返す
  return { level, message: "m", timestamp: 0, ...extra };
}

// テスト用の console モックを作る
function makeConsole() {
  // すべてのメソッドを vi.fn でラップ
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

describe("createConsoleTransport", () => {
  // name 既定値の確認
  it("name は 'console' を返す", () => {
    // インスタンス生成
    const t = createConsoleTransport({ console: makeConsole() });
    // 名前
    expect(t.name).toBe("console");
  });

  // trace は console.debug へ
  it("trace は console.debug にディスパッチ", () => {
    const con = makeConsole();
    const t = createConsoleTransport({ console: con });
    t.write(entry("trace"));
    expect(con.debug).toHaveBeenCalledTimes(1);
  });

  // debug は console.debug へ
  it("debug は console.debug にディスパッチ", () => {
    const con = makeConsole();
    const t = createConsoleTransport({ console: con });
    t.write(entry("debug"));
    expect(con.debug).toHaveBeenCalledTimes(1);
  });

  // info は console.info へ
  it("info は console.info にディスパッチ", () => {
    const con = makeConsole();
    const t = createConsoleTransport({ console: con });
    t.write(entry("info"));
    expect(con.info).toHaveBeenCalledTimes(1);
  });

  // warn は console.warn へ
  it("warn は console.warn にディスパッチ", () => {
    const con = makeConsole();
    const t = createConsoleTransport({ console: con });
    t.write(entry("warn"));
    expect(con.warn).toHaveBeenCalledTimes(1);
  });

  // error は console.error へ
  it("error は console.error にディスパッチ", () => {
    const con = makeConsole();
    const t = createConsoleTransport({ console: con });
    t.write(entry("error"));
    expect(con.error).toHaveBeenCalledTimes(1);
  });

  // fatal は console.error へ
  it("fatal は console.error にディスパッチ", () => {
    const con = makeConsole();
    const t = createConsoleTransport({ console: con });
    t.write(entry("fatal"));
    expect(con.error).toHaveBeenCalledTimes(1);
  });

  // format 未指定なら entry そのものが渡る
  it("format 未指定なら entry が引数として渡る", () => {
    const con = makeConsole();
    const t = createConsoleTransport({ console: con });
    const e = entry("info", { message: "hello" });
    t.write(e);
    expect(con.info).toHaveBeenCalledWith(e);
  });

  // format 指定時はその出力が console に渡される
  it("format 指定時は format の戻り値が console に展開される", () => {
    const con = makeConsole();
    // 整形関数
    const format = vi.fn((e: LogEntry) => [e.level, e.message]);
    const t = createConsoleTransport({ console: con, format });
    // info を出力
    t.write(entry("info", { message: "hi" }));
    // format が呼ばれている
    expect(format).toHaveBeenCalledTimes(1);
    // 戻り値が console.info に展開
    expect(con.info).toHaveBeenCalledWith("info", "hi");
  });

  // 注入しない場合はグローバル console を使う
  it("console 未指定ならグローバル console を使う", () => {
    // グローバル console をスパイ
    const spy = vi.spyOn(globalThis.console, "info").mockImplementation(() => {});
    try {
      // 注入なしで生成
      const t = createConsoleTransport();
      // info を出力
      t.write(entry("info"));
      // グローバル console が呼ばれた
      expect(spy).toHaveBeenCalled();
    } finally {
      // モックを解除
      spy.mockRestore();
    }
  });
});
