// vitest の API を取り込む
import { describe, expect, it } from "vitest";
// Node の URL→path 変換を取り込む (ESM 環境で fixture の絶対パスを得るため)
import { fileURLToPath } from "node:url";
// 対象関数とエラークラスを取り込む
import { loadConfig, loadConfigSync } from "./load.js";
import { ConfigLoaderError } from "./errors.js";

// __fixtures__ 配下の相対パスを絶対パスに解決するヘルパ
function fixture(relative: string): string {
  // import.meta.url を基準に絶対パスを返す
  return fileURLToPath(new URL(`./__fixtures__/${relative}`, import.meta.url));
}

// loadConfig (非同期) の振る舞いを網羅するテスト
describe("loadConfig (async)", () => {
  // 正常 JSON が読み込まれてオブジェクトとして返ることを確認
  it("reads and parses JSON file", async () => {
    // 既知の fixture を読む
    const v = (await loadConfig(fixture("valid.json"))) as { env: string };
    // env フィールドが期待値
    expect(v.env).toBe("dev");
  });

  // 正常 YAML が読み込まれることを確認
  it("reads and parses YAML file", async () => {
    // YAML fixture を読む
    const v = (await loadConfig(fixture("valid.yaml"))) as { env: string };
    // env フィールドが期待値
    expect(v.env).toBe("dev");
  });

  // 未知の拡張子で UNSUPPORTED_EXT になることを確認
  it("throws UNSUPPORTED_EXT for unknown extension", async () => {
    // .txt は対応外なので拒否される
    await expect(loadConfig(fixture("unknown.txt"))).rejects.toMatchObject({
      // code を一致確認
      code: "UNSUPPORTED_EXT",
    });
  });

  // パスが存在しない場合に FILE_NOT_FOUND になることを確認
  it("throws FILE_NOT_FOUND when file is missing", async () => {
    // 存在しないパスを指定
    await expect(loadConfig(fixture("does-not-exist.json"))).rejects.toMatchObject({
      // code を確認
      code: "FILE_NOT_FOUND",
    });
  });

  // ディレクトリを .json として開き、EISDIR 系の I/O 例外で IO_ERROR にマップされることを確認
  it("throws IO_ERROR when path points to a directory", async () => {
    // 例外捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // 拡張子は .json だが実体はディレクトリの fixture
      await loadConfig(fixture("dir-as-file.json"));
    } catch (e) {
      // 受け取り
      caught = e as ConfigLoaderError;
    }
    // ConfigLoaderError であること
    expect(caught).toBeInstanceOf(ConfigLoaderError);
    // IO_ERROR に分類される (ENOENT 以外の errno はすべて IO_ERROR)
    expect(caught?.code).toBe("IO_ERROR");
    // cause に元 errno 例外が伝播していること
    expect(caught?.cause).toBeDefined();
  });

  // 壊れた YAML で PARSE_ERROR になることを確認
  it("throws PARSE_ERROR on broken YAML", async () => {
    // 例外を捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // 壊れた YAML fixture
      await loadConfig(fixture("broken.yaml"));
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // code 確認
    expect(caught?.code).toBe("PARSE_ERROR");
  });
});

// loadConfigSync の振る舞いを網羅するテスト
describe("loadConfigSync", () => {
  // 正常 JSON を同期で読めることを確認
  it("reads and parses JSON file synchronously", () => {
    // 同期で読む
    const v = loadConfigSync(fixture("valid.json")) as { env: string };
    // 内容確認
    expect(v.env).toBe("dev");
  });

  // 正常 YAML を同期で読めることを確認
  it("reads and parses YAML file synchronously", () => {
    // 同期で読む
    const v = loadConfigSync(fixture("valid.yaml")) as { env: string };
    // 内容確認
    expect(v.env).toBe("dev");
  });

  // 未知拡張子で UNSUPPORTED_EXT
  it("throws UNSUPPORTED_EXT for unknown extension (sync)", () => {
    // 例外捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // .txt は対応外
      loadConfigSync(fixture("unknown.txt"));
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // code 一致
    expect(caught?.code).toBe("UNSUPPORTED_EXT");
  });

  // 不在パスで FILE_NOT_FOUND
  it("throws FILE_NOT_FOUND when file is missing (sync)", () => {
    // 例外捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // 存在しないパス
      loadConfigSync(fixture("does-not-exist.json"));
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // code 一致
    expect(caught?.code).toBe("FILE_NOT_FOUND");
  });

  // ディレクトリを .json として開いて IO_ERROR
  it("throws IO_ERROR when path points to a directory (sync)", () => {
    // 例外捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // ディレクトリを .json として開く
      loadConfigSync(fixture("dir-as-file.json"));
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // IO_ERROR であること
    expect(caught?.code).toBe("IO_ERROR");
  });

  // 壊れた JSON で PARSE_ERROR
  it("throws PARSE_ERROR on broken JSON (sync)", () => {
    // 例外捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // 壊れた JSON fixture を読む
      loadConfigSync(fixture("broken.json"));
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // code 一致
    expect(caught?.code).toBe("PARSE_ERROR");
  });
});
