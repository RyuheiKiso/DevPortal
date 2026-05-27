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
    // cause に元例外が伝播していること (js-yaml は Error の派生を投げる)
    expect((caught as ConfigLoaderError).cause).toBeDefined();
  });

  // filePath を渡したときメッセージに file: が含まれることを確認
  it("includes filePath in error message when provided", () => {
    // 例外を捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // 壊れた YAML とファイルパス
      parseYaml("a: 1\n  bad: indent\n bad2: indent", "/tmp/x.yaml");
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // メッセージにパスが含まれること
    expect(caught?.message).toContain("/tmp/x.yaml");
  });

  // __proto__ キーを含む YAML をパースしても Object.prototype が汚染されないこと
  // （信頼できない config ソースを読み込むケースを想定）
  it("strips __proto__ keys to prevent prototype pollution", () => {
    // __proto__ 経由で polluted を生やそうとする YAML
    const malicious = '__proto__:\n  polluted: true\nfoo: 1\n';
    // パース実行（throw しないこと）
    const result = parseYaml(malicious) as Record<string, unknown>;
    // foo は通常通り取り出せる
    expect(result.foo).toBe(1);
    // __proto__ プロパティは strip されているため、結果オブジェクトには存在しない
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
    // そして他の素のオブジェクトに polluted が漏れていない
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  // constructor / prototype キーも同様に除去されること
  it("strips constructor and prototype keys", () => {
    // 危険キーを並べた YAML（ネストにも仕込む）
    const malicious = 'constructor:\n  bad: 1\nprototype:\n  bad: 2\nnested:\n  __proto__:\n    deep: true\n  ok: yes\n';
    // パース実行
    const result = parseYaml(malicious) as Record<string, unknown>;
    // トップレベルの constructor / prototype は strip
    expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "prototype")).toBe(false);
    // nested.__proto__ も strip されつつ、ok は残る
    const nested = result.nested as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(nested, "__proto__")).toBe(false);
    expect(nested.ok).toBe("yes");
  });

  // 配列の中にあるオブジェクトの危険キーも再帰的に除去されること
  it("strips dangerous keys inside arrays recursively", () => {
    // 配列要素の中に __proto__ を仕込む
    const malicious = 'items:\n  - __proto__:\n      pwned: true\n    name: a\n  - name: b\n';
    // パース実行
    const result = parseYaml(malicious) as { items: Array<Record<string, unknown>> };
    // 配列要素の __proto__ も削除されている
    expect(Object.prototype.hasOwnProperty.call(result.items[0], "__proto__")).toBe(false);
    // 正常なキーは保持されている
    expect(result.items[0].name).toBe("a");
    expect(result.items[1].name).toBe("b");
  });

  // js-yaml DEFAULT_SCHEMA が ISO 文字列を Date インスタンスとしてパースする場合に
  // sanitize が Date を空 {} に潰さず型情報を保持することを保証
  it("preserves Date instances parsed from ISO timestamps", () => {
    // !!timestamp タグ相当の ISO 文字列
    const yaml = 'releasedAt: 2024-01-01T00:00:00Z\nname: v1\n';
    // パース実行
    const result = parseYaml(yaml) as { releasedAt: unknown; name: string };
    // js-yaml DEFAULT_SCHEMA は ISO 文字列を Date として返す
    expect(result.releasedAt).toBeInstanceOf(Date);
    // Date のメソッドが呼べる（型情報保持）
    expect((result.releasedAt as Date).getTime()).toBe(new Date("2024-01-01T00:00:00Z").getTime());
    // 通常キーも残る
    expect(result.name).toBe("v1");
  });

  // 結果オブジェクトのプロトタイプが標準 Object.prototype であることを assert（汚染検知）
  it("returns plain object with Object.prototype as its prototype", () => {
    // 通常 YAML
    const yaml = 'foo: 1\nbar: x\n';
    // パース結果
    const result = parseYaml(yaml) as Record<string, unknown>;
    // プロトタイプが Object.prototype であること（汚染なしの保証）
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});
