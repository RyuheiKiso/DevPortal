// vitest の API を取り込む
import { describe, expect, it } from "vitest";
// 対象関数とエラークラスを取り込む
import { detectParser } from "./detect.js";
import { ConfigLoaderError } from "./errors.js";
// パーサ関数を直接取り込み (戻り値の同一参照確認用)
import { parseJson } from "./json.js";
import { parseYaml } from "./yaml.js";

// detectParser の振る舞いを網羅するテスト
describe("detectParser", () => {
  // .json は parseJson を返す
  it("returns parseJson for .json", () => {
    // 同一参照で返ることを確認
    expect(detectParser("documents/a.json")).toBe(parseJson);
  });

  // .yaml と .yml はいずれも parseYaml を返す
  it("returns parseYaml for .yaml", () => {
    // .yaml の判定
    expect(detectParser("documents/a.yaml")).toBe(parseYaml);
  });

  // .yml も同じ扱い
  it("returns parseYaml for .yml", () => {
    // .yml の判定
    expect(detectParser("documents/a.yml")).toBe(parseYaml);
  });

  // バックスラッシュ区切りのパスでも正しく拡張子を抽出できる
  it("handles backslash separators (Windows-style paths)", () => {
    // バックスラッシュ区切りの絶対パス
    expect(detectParser("C:\\Users\\app\\a.json")).toBe(parseJson);
  });

  // 大文字拡張子も小文字化されて判定される
  it("is case-insensitive on extension", () => {
    // .JSON でも parseJson が返る
    expect(detectParser("a.JSON")).toBe(parseJson);
    // .YAML でも parseYaml が返る
    expect(detectParser("a.YAML")).toBe(parseYaml);
  });

  // 未知の拡張子で UNSUPPORTED_EXT が投げられる
  it("throws ConfigLoaderError(UNSUPPORTED_EXT) for unknown extensions", () => {
    // 例外捕捉
    let caught: unknown;
    try {
      // .txt は対応外
      detectParser("documents/a.txt");
    } catch (e) {
      // catch
      caught = e;
    }
    // ConfigLoaderError であること
    expect(caught).toBeInstanceOf(ConfigLoaderError);
    // code 確認
    expect((caught as ConfigLoaderError).code).toBe("UNSUPPORTED_EXT");
    // メッセージに拡張子が含まれる
    expect((caught as ConfigLoaderError).message).toContain(".txt");
  });

  // 拡張子なしのときは (none) が表示される
  it("uses '(none)' label when extension is missing", () => {
    // 例外捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // 拡張子なしのファイル名
      detectParser("documents/noext");
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // メッセージに (none) ラベルが含まれる
    expect(caught?.message).toContain("(none)");
  });

  // 先頭ドットのみのファイル (.env など) も拡張子なし扱い
  it("treats leading-dot filenames as having no extension", () => {
    // .env も拡張子なし扱いとなり UNSUPPORTED_EXT
    expect(() => detectParser(".env")).toThrowError(/Unsupported/);
  });
});
