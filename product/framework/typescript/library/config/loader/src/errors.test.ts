// vitest の API を取り込む
import { describe, expect, it } from "vitest";
// 対象クラスを取り込む
import { ConfigLoaderError } from "./errors.js";

// ConfigLoaderError の振る舞いを網羅するテスト
describe("ConfigLoaderError", () => {
  // code と name が期待通り設定されることを確認
  it("sets code and name correctly", () => {
    // インスタンスを作成
    const err = new ConfigLoaderError("boom", "PARSE_ERROR");
    // name は安定識別子であるべき
    expect(err.name).toBe("ConfigLoaderError");
    // code が引数のまま入る
    expect(err.code).toBe("PARSE_ERROR");
    // メッセージも保持される
    expect(err.message).toBe("boom");
    // 標準 Error の派生であること
    expect(err).toBeInstanceOf(Error);
  });

  // cause を渡した場合に Error.cause として伝播することを確認
  it("propagates cause when provided", () => {
    // 原因となる元エラー
    const original = new Error("original");
    // cause 付きで生成
    const err = new ConfigLoaderError("wrap", "IO_ERROR", original);
    // ES2022 cause が保持される
    expect(err.cause).toBe(original);
  });

  // cause を省略した場合は cause が undefined のままになることを確認
  it("leaves cause undefined when omitted", () => {
    // cause なしで生成
    const err = new ConfigLoaderError("no cause", "UNSUPPORTED_EXT");
    // cause は未設定
    expect(err.cause).toBeUndefined();
  });
});
