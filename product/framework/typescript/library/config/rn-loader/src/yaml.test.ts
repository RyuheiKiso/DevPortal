// vitest の API を取り込む
import { describe, expect, it } from "vitest";
// 対象関数とエラークラスを取り込む
import { parseYaml } from "./yaml.js";
import { ConfigLoaderError } from "./errors.js";

// parseYaml の振る舞いを網羅するテスト
describe("parseYaml", () => {
  // 正常 YAML がパースされることを確認
  it("parses valid YAML content", () => {
    // 単純なマッピングをパース
    const result = parseYaml("a: 1\nb: x\n");
    // 期待結果と等しい
    expect(result).toEqual({ a: 1, b: "x" });
  });

  // 壊れた YAML で PARSE_ERROR を投げることを確認
  it("throws ConfigLoaderError(PARSE_ERROR) on invalid YAML", () => {
    // 例外を捕捉
    let caught: unknown;
    try {
      // インデント不正で YAMLException を発生させる
      parseYaml("a: 1\n  bad: indent\n bad2: indent");
    } catch (e) {
      // catch
      caught = e;
    }
    // ConfigLoaderError であること
    expect(caught).toBeInstanceOf(ConfigLoaderError);
    // PARSE_ERROR
    expect((caught as ConfigLoaderError).code).toBe("PARSE_ERROR");
    // cause に元例外が伝播していること
    expect((caught as ConfigLoaderError).cause).toBeDefined();
  });

  // filePath を渡したときメッセージに file: が含まれることを確認
  it("includes filePath in error message when provided", () => {
    // 例外を捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // 壊れた YAML とファイルパス
      parseYaml("a: 1\n  bad: indent\n bad2: indent", "documents/x.yaml");
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // メッセージにパスが含まれること
    expect(caught?.message).toContain("documents/x.yaml");
  });
});
