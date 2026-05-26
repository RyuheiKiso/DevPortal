// vitest の API を取り込む
import { describe, expect, it } from "vitest";
// zod を取り込み (loadAndValidate 検証用)
import { z } from "zod";
// 対象関数と関連型を取り込む
import { createLoader } from "./loader.js";
import { ConfigLoaderError } from "./errors.js";
import type { FileSystemBackend } from "./types.js";

// テスト用にメモリ上のファイルマップから読む簡易バックエンドを生成するヘルパ
// path → content のマップを受け取り、存在しないキーは exists=false / readFile で投げる
function makeBackend(files: Record<string, string>): FileSystemBackend {
  // FileSystemBackend を満たすオブジェクトを返す
  return {
    // 指定パスのファイルがあれば内容を返す
    async readFile(filePath: string): Promise<string> {
      // マップ参照
      const content = files[filePath];
      // 未登録パスは FILE_NOT_FOUND
      if (content === undefined) {
        throw new ConfigLoaderError(`Config file not found: ${filePath}`, "FILE_NOT_FOUND");
      }
      // 登録済みなら内容を返す
      return content;
    },
    // 指定パスが files キーに存在するかを返す
    async exists(filePath: string): Promise<boolean> {
      // key が含まれているかを判定
      return Object.prototype.hasOwnProperty.call(files, filePath);
    },
  };
}

// 検証に使う簡易スキーマ
const minimalSchema = z.object({
  // env は dev/staging/prod のいずれか
  env: z.enum(["dev", "staging", "prod"]),
});

// createLoader の振る舞いを網羅するテスト
describe("createLoader.loadConfig", () => {
  // JSON 文字列を読んでパースして返すことを確認
  it("loads JSON file via backend", async () => {
    // メモリバックエンドを準備
    const loader = createLoader(makeBackend({ "/a.json": '{"env":"dev"}' }));
    // ロード結果を確認
    const v = (await loader.loadConfig("/a.json")) as { env: string };
    expect(v.env).toBe("dev");
  });

  // YAML 文字列を読んでパースして返すことを確認
  it("loads YAML file via backend", async () => {
    // YAML 内容を返すバックエンド
    const loader = createLoader(makeBackend({ "/a.yaml": "env: staging\n" }));
    // ロード結果を確認
    const v = (await loader.loadConfig("/a.yaml")) as { env: string };
    expect(v.env).toBe("staging");
  });

  // 未対応拡張子で UNSUPPORTED_EXT が投げられる
  it("throws UNSUPPORTED_EXT for unknown extension", async () => {
    // 拡張子は .txt
    const loader = createLoader(makeBackend({ "/a.txt": "plain" }));
    // 拒否されるはず
    await expect(loader.loadConfig("/a.txt")).rejects.toMatchObject({ code: "UNSUPPORTED_EXT" });
  });

  // バックエンドが投げる ConfigLoaderError は包まずに透過することを確認
  it("propagates ConfigLoaderError from backend (FILE_NOT_FOUND)", async () => {
    // 空マップなのでどのパスも存在しない
    const loader = createLoader(makeBackend({}));
    // バックエンドが投げた FILE_NOT_FOUND がそのまま透過
    await expect(loader.loadConfig("/missing.json")).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  // バックエンドが ConfigLoaderError 以外を投げた場合は IO_ERROR にラップされる
  it("wraps non-ConfigLoaderError as IO_ERROR", async () => {
    // 任意のエラーを投げるバックエンド
    const backend: FileSystemBackend = {
      // readFile が string を throw する (非 Error 系)
      async readFile(): Promise<string> {
        throw new Error("disk failure");
      },
      // exists は使われない
      async exists(): Promise<boolean> {
        return true;
      },
    };
    // ロード時に IO_ERROR にラップされる
    const loader = createLoader(backend);
    // 例外捕捉
    let caught: ConfigLoaderError | undefined;
    try {
      await loader.loadConfig("/a.json");
    } catch (e) {
      caught = e as ConfigLoaderError;
    }
    // IO_ERROR + cause が元エラー
    expect(caught?.code).toBe("IO_ERROR");
    expect(caught?.cause).toBeInstanceOf(Error);
  });

  // 壊れた JSON で PARSE_ERROR
  it("throws PARSE_ERROR on broken JSON", async () => {
    // 壊れた JSON を返すバックエンド
    const loader = createLoader(makeBackend({ "/a.json": "{ broken" }));
    // PARSE_ERROR が飛ぶ
    await expect(loader.loadConfig("/a.json")).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });
});

// exists の振る舞いを網羅するテスト
describe("createLoader.exists", () => {
  // バックエンドの exists が true ならそのまま返ることを確認
  it("returns true when backend reports existence", async () => {
    // ファイルが登録済み
    const loader = createLoader(makeBackend({ "/a.json": "{}" }));
    // exists の結果が true
    expect(await loader.exists("/a.json")).toBe(true);
  });

  // バックエンドの exists が false なら false が返ることを確認
  it("returns false when backend reports absence", async () => {
    // 登録されていないパス
    const loader = createLoader(makeBackend({ "/a.json": "{}" }));
    // false が返る
    expect(await loader.exists("/missing.json")).toBe(false);
  });

  // バックエンドが exists で例外を投げた場合に透過することを確認
  it("propagates errors from backend.exists", async () => {
    // exists で BACKEND_UNAVAILABLE を投げるバックエンド
    const backend: FileSystemBackend = {
      // readFile は使わない
      async readFile(): Promise<string> {
        return "";
      },
      // exists が ConfigLoaderError を投げる
      async exists(): Promise<boolean> {
        throw new ConfigLoaderError("missing peer", "BACKEND_UNAVAILABLE");
      },
    };
    // ロードした exists も同じエラーを伝播
    const loader = createLoader(backend);
    await expect(loader.exists("/x.json")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });
});

// loadAndValidate の振る舞いを網羅するテスト
describe("createLoader.loadAndValidate", () => {
  // 正常時に T 型として値が返ることを確認
  it("returns validated value when schema matches", async () => {
    // 有効な内容を返すバックエンド
    const loader = createLoader(makeBackend({ "/a.json": '{"env":"dev"}' }));
    // 検証付きロード
    const v = await loader.loadAndValidate("/a.json", minimalSchema);
    expect(v.env).toBe("dev");
  });

  // 検証失敗時に ZodError が透過することを確認
  it("propagates ZodError on validation failure", async () => {
    // 想定外フィールドのみの内容
    const loader = createLoader(makeBackend({ "/a.json": '{"foo":"bar"}' }));
    // ZodError が投げられる
    await expect(loader.loadAndValidate("/a.json", minimalSchema)).rejects.toBeInstanceOf(z.ZodError);
  });
});

// loadEnvConfigMap の振る舞いを網羅するテスト
describe("createLoader.loadEnvConfigMap", () => {
  // dev + staging + prod が JSON/YAML 混在で揃っている場合
  it("loads dev/staging/prod with mixed extensions", async () => {
    // dev=JSON / staging=YAML / prod=YML
    const loader = createLoader(makeBackend({
      "/env/dev.json": '{"apiUrl":"http://localhost"}',
      "/env/staging.yaml": "apiUrl: https://stg.example.com\n",
      "/env/prod.yml": "apiUrl: https://api.example.com\n",
    }));
    // マップを取得
    const map = await loader.loadEnvConfigMap("/env");
    // 各環境が読まれていること
    expect(map.dev).toMatchObject({ apiUrl: "http://localhost" });
    expect(map.staging).toMatchObject({ apiUrl: "https://stg.example.com" });
    expect(map.prod).toMatchObject({ apiUrl: "https://api.example.com" });
  });

  // 末尾スラッシュ付き dir でも正規化されることを確認
  it("handles trailing slash in directory path", async () => {
    // dev のみ
    const loader = createLoader(makeBackend({ "/env/dev.json": '{"apiUrl":"x"}' }));
    // 末尾スラッシュ付きで呼ぶ
    const map = await loader.loadEnvConfigMap("/env/");
    // 正常に dev が取得できる
    expect(map.dev).toMatchObject({ apiUrl: "x" });
  });

  // staging と prod が欠けていたら {} 補完
  it("returns empty objects when staging/prod are missing", async () => {
    // dev のみ
    const loader = createLoader(makeBackend({ "/env/dev.json": '{"apiUrl":"x"}' }));
    // マップを取得
    const map = await loader.loadEnvConfigMap("/env");
    // dev は読み込まれる
    expect(map.dev).toMatchObject({ apiUrl: "x" });
    // staging/prod は {} 補完
    expect(map.staging).toEqual({});
    expect(map.prod).toEqual({});
  });

  // dev が欠けている場合は FILE_NOT_FOUND
  it("throws FILE_NOT_FOUND when dev is missing", async () => {
    // dev も無いディレクトリ (バックエンド空)
    const loader = createLoader(makeBackend({}));
    // FILE_NOT_FOUND になるはず
    await expect(loader.loadEnvConfigMap("/env")).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  // dev がトップレベル配列の場合は PARSE_ERROR (構造エラー)
  it("throws PARSE_ERROR when top level of dev is not an object", async () => {
    // 配列内容
    const loader = createLoader(makeBackend({ "/env/dev.json": "[1,2,3]" }));
    // PARSE_ERROR が飛ぶ
    await expect(loader.loadEnvConfigMap("/env")).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });

  // staging が null の場合も PARSE_ERROR (構造エラー)
  it("throws PARSE_ERROR when staging is null", async () => {
    // staging YAML が null
    const loader = createLoader(makeBackend({
      "/env/dev.json": '{"apiUrl":"x"}',
      "/env/staging.yaml": "null\n",
    }));
    // PARSE_ERROR が飛ぶ
    await expect(loader.loadEnvConfigMap("/env")).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });

  // prod が配列の場合も PARSE_ERROR (構造エラー)
  it("throws PARSE_ERROR when prod is array", async () => {
    // prod が配列
    const loader = createLoader(makeBackend({
      "/env/dev.json": '{"apiUrl":"x"}',
      "/env/prod.json": "[1,2,3]",
    }));
    // PARSE_ERROR が飛ぶ
    await expect(loader.loadEnvConfigMap("/env")).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });

  // 同名 baseName で .json と .yaml が両方ある場合に .json が優先されることを確認
  it("prefers .json over .yaml when both extensions exist", async () => {
    // dev.json と dev.yaml を両方登録 (JSON は apiUrl=json、YAML は apiUrl=yaml)
    const loader = createLoader(makeBackend({
      "/env/dev.json": '{"apiUrl":"json"}',
      "/env/dev.yaml": "apiUrl: yaml\n",
    }));
    // マップを取得
    const map = await loader.loadEnvConfigMap("/env");
    // .json が選ばれて apiUrl=json になる
    expect(map.dev).toMatchObject({ apiUrl: "json" });
  });

  // .yaml と .yml が両方ある場合は .yaml が優先される
  it("prefers .yaml over .yml when both extensions exist (no .json)", async () => {
    // dev.yaml と dev.yml を両方登録
    const loader = createLoader(makeBackend({
      "/env/dev.yaml": "apiUrl: yaml\n",
      "/env/dev.yml": "apiUrl: yml\n",
    }));
    // マップを取得
    const map = await loader.loadEnvConfigMap("/env");
    // .yaml が選ばれて apiUrl=yaml になる
    expect(map.dev).toMatchObject({ apiUrl: "yaml" });
  });
});
