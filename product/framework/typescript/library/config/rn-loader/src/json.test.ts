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
    // 例外を捕捉
    let caught: unknown;
    try {
      // 壊れた JSON
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

  // BOM 付き UTF-8 JSON を正しくパースできることを確認
  it("strips UTF-8 BOM before parsing", () => {
    // 先頭に U+FEFF を付けた JSON 文字列
    const withBom = "﻿" + '{"a":1}';
    // BOM が除去されて正しくパースされる
    expect(parseJson(withBom)).toEqual({ a: 1 });
  });

  // BOM の無い通常の JSON もそのままパースできる (回帰確認)
  it("parses content without BOM unchanged", () => {
    // BOM 無しの単純な JSON
    expect(parseJson('{"x":2}')).toEqual({ x: 2 });
  });

  // filePath を渡したときメッセージに file: が含まれることを確認
  it("includes filePath in error message when provided", () => {
    // 例外を捕捉して内容確認
    let caught: ConfigLoaderError | undefined;
    try {
      // 壊れた JSON とファイルパス
      parseJson("{ broken", "documents/x.json");
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // メッセージにパスが含まれること
    expect(caught?.message).toContain("documents/x.json");
  });

  // __proto__ キーを含む JSON でも汚染が起きず、own プロパティとして strip されること
  it("strips __proto__ key to prevent prototype pollution", () => {
    // JSON.parse は __proto__ を own data property としてセットする（仕様準拠）
    const malicious = '{"__proto__":{"polluted":true},"ok":1}';
    // parseJson 経由
    const result = parseJson(malicious) as Record<string, unknown>;
    // own プロパティの __proto__ は除去されている
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
    // 正常キーは保持
    expect(result.ok).toBe(1);
    // 結果のプロトタイプは標準 Object.prototype（汚染なし）
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    // 素のオブジェクトに polluted が漏れていない
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  // constructor / prototype キーも除去されること
  it("strips constructor and prototype keys recursively", () => {
    // 危険キーを並べた JSON（ネストにも仕込む）
    const malicious = '{"constructor":{"bad":1},"prototype":{"bad":2},"nested":{"__proto__":{"deep":true},"ok":"yes"}}';
    // parseJson 経由
    const result = parseJson(malicious) as Record<string, unknown>;
    // トップレベルの危険キーは除去
    expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "prototype")).toBe(false);
    // ネストの __proto__ も除去、ok は残る
    const nested = result.nested as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(nested, "__proto__")).toBe(false);
    expect(nested.ok).toBe("yes");
  });
});
