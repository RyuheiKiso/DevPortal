// vitest の API を取り込む
import { describe, expect, it } from "vitest";
// 対象関数とエラークラスを取り込む
import { parseJson } from "./json.js";
import { ConfigLoaderError } from "./errors.js";

// parseJson の振る舞いを網羅するテスト
describe("parseJson", () => {
  // 正常 JSON がパースされることを確認
  it("parses valid JSON content", () => {
    // 単純なオブジェクト文字列をパース
    const result = parseJson('{"a":1,"b":"x"}');
    // 期待結果と等しい
    expect(result).toEqual({ a: 1, b: "x" });
  });

  // 壊れた JSON で PARSE_ERROR を投げ、cause が SyntaxError であることを確認
  it("throws ConfigLoaderError(PARSE_ERROR) with cause on invalid JSON", () => {
    // ファイルパスを渡さない経路もカバー
    let caught: unknown;
    try {
      // 末尾カンマで壊れた JSON
      parseJson("{ invalid }");
    } catch (e) {
      // catch して中身を確認
      caught = e;
    }
    // ConfigLoaderError であること
    expect(caught).toBeInstanceOf(ConfigLoaderError);
    // code が PARSE_ERROR
    expect((caught as ConfigLoaderError).code).toBe("PARSE_ERROR");
    // 元の SyntaxError が cause に保持されている
    expect((caught as ConfigLoaderError).cause).toBeInstanceOf(SyntaxError);
    // メッセージにファイルパスが含まれない (filePath 省略経路)
    expect((caught as ConfigLoaderError).message).not.toContain("file:");
  });

  // filePath を渡したときメッセージに file: が含まれることを確認
  it("includes filePath in error message when provided", () => {
    // 例外を捕捉して内容確認
    let caught: ConfigLoaderError | undefined;
    try {
      // 壊れた JSON とファイルパス
      parseJson("{ broken", "/tmp/x.json");
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // メッセージにパスが含まれること
    expect(caught?.message).toContain("/tmp/x.json");
  });
});
