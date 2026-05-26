// vitest の API を取り込む
import { describe, expect, it } from "vitest";
// Node の URL→path 変換を取り込む
import { fileURLToPath } from "node:url";
// 対象関数とエラークラスを取り込む
import { loadEnvConfigMap, loadEnvConfigMapSync } from "./loadEnv.js";
import { ConfigLoaderError } from "./errors.js";

// __fixtures__ 配下の相対パスを絶対パスに解決するヘルパ
function fixture(relative: string): string {
  // import.meta.url を基準に絶対パスを返す
  return fileURLToPath(new URL(`./__fixtures__/${relative}`, import.meta.url));
}

// loadEnvConfigMap (非同期) の振る舞いを網羅するテスト
describe("loadEnvConfigMap (async)", () => {
  // dev + staging + prod が JSON/YAML 混在で揃っている場合
  it("loads dev/staging/prod from mixed JSON+YAML", async () => {
    // env ディレクトリを指す
    const map = await loadEnvConfigMap(fixture("env"));
    // dev は JSON
    expect(map.dev).toMatchObject({ apiUrl: "http://localhost:3000", logLevel: "debug" });
    // staging は YAML
    expect(map.staging).toMatchObject({ apiUrl: "https://staging.example.com" });
    // prod は .yml
    expect(map.prod).toMatchObject({ apiUrl: "https://api.example.com" });
  });

  // staging/prod が欠けている場合は {} で補完される
  it("returns empty objects when staging/prod are missing", async () => {
    // dev のみ存在するディレクトリ
    const map = await loadEnvConfigMap(fixture("env-dev-only"));
    // dev は読み込まれる
    expect(map.dev).toMatchObject({ apiUrl: "http://localhost:3000" });
    // staging/prod は {} 補完
    expect(map.staging).toEqual({});
    expect(map.prod).toEqual({});
  });

  // dev が欠けている場合は FILE_NOT_FOUND
  it("throws FILE_NOT_FOUND when dev is missing", async () => {
    // dev も無いディレクトリ
    await expect(loadEnvConfigMap(fixture("env-missing"))).rejects.toMatchObject({
      // code 確認
      code: "FILE_NOT_FOUND",
    });
  });

  // dev がトップレベル配列の場合は PARSE_ERROR (構造エラー)
  it("throws PARSE_ERROR when top level is not an object", async () => {
    // 配列 fixture を読む
    await expect(loadEnvConfigMap(fixture("env-array"))).rejects.toMatchObject({
      // PARSE_ERROR にマップされる
      code: "PARSE_ERROR",
    });
  });
});

// loadEnvConfigMapSync (同期) の振る舞いを網羅するテスト
describe("loadEnvConfigMapSync", () => {
  // 同期で 3 ファイル揃って読めることを確認
  it("loads dev/staging/prod synchronously", () => {
    // 同期で読む
    const map = loadEnvConfigMapSync(fixture("env"));
    // dev / staging / prod すべて取れる
    expect(map.dev).toMatchObject({ logLevel: "debug" });
    expect(map.staging).toMatchObject({ logLevel: "info" });
    expect(map.prod).toMatchObject({ logLevel: "warn" });
  });

  // 同期で staging/prod 欠けは {}
  it("returns empty objects when staging/prod missing (sync)", () => {
    // dev のみのディレクトリ
    const map = loadEnvConfigMapSync(fixture("env-dev-only"));
    // dev 読み込み確認
    expect(map.dev).toMatchObject({ apiUrl: "http://localhost:3000" });
    // staging/prod は {} 補完
    expect(map.staging).toEqual({});
    expect(map.prod).toEqual({});
  });

  // 同期で dev 欠けは FILE_NOT_FOUND
  it("throws FILE_NOT_FOUND when dev missing (sync)", () => {
    // 例外捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // dev も無いディレクトリ
      loadEnvConfigMapSync(fixture("env-missing"));
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // code 一致
    expect(caught?.code).toBe("FILE_NOT_FOUND");
  });

  // 同期で配列 dev は PARSE_ERROR
  it("throws PARSE_ERROR when top level is not an object (sync)", () => {
    // 例外捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      // 配列 fixture
      loadEnvConfigMapSync(fixture("env-array"));
    } catch (e) {
      // 型キャスト
      caught = e as ConfigLoaderError;
    }
    // code 一致
    expect(caught?.code).toBe("PARSE_ERROR");
  });
});
