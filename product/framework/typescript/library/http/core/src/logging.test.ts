// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { noopLogger } from "./logging.js";

describe("noopLogger", () => {
  // 4 メソッドすべてが副作用なし
  it("debug/info/warn/error は副作用なく undefined を返す", () => {
    expect(noopLogger.debug("x")).toBeUndefined();
    expect(noopLogger.info("x", { a: 1 })).toBeUndefined();
    expect(noopLogger.warn("x")).toBeUndefined();
    expect(noopLogger.error("x", new Error("e"))).toBeUndefined();
  });
});
