// vitest の API を取り込む
import { beforeEach, describe, expect, it, vi } from "vitest";

// expo-file-system の legacy API 形のモック型
interface MockExpoLegacyFS {
  // 読み出し関数 (legacy API)
  readAsStringAsync: ReturnType<typeof vi.fn>;
  // 情報取得関数 (exists プロパティを含む)
  getInfoAsync: ReturnType<typeof vi.fn>;
  // 永続データディレクトリ URI
  documentDirectory: string | null;
  // キャッシュディレクトリ URI
  cacheDirectory: string | null;
}

// 既定値で legacy 形 mock を組み立てるヘルパ
function makeMockExpoFS(overrides: Partial<MockExpoLegacyFS> = {}): MockExpoLegacyFS {
  // overrides で部分上書き可
  return {
    // デフォルト: "content" を返す
    readAsStringAsync: overrides.readAsStringAsync ?? vi.fn().mockResolvedValue("content"),
    // デフォルト: exists=true を返す
    getInfoAsync: overrides.getInfoAsync ?? vi.fn().mockResolvedValue({ exists: true }),
    // documentDirectory は末尾スラッシュ付き URI が一般的
    documentDirectory: overrides.documentDirectory === undefined ? "file:///app/docs/" : overrides.documentDirectory,
    // cacheDirectory も同様
    cacheDirectory: overrides.cacheDirectory === undefined ? "file:///app/cache/" : overrides.cacheDirectory,
  };
}

// 新 File API 形 (SDK 52+) のモック組み立てヘルパ
// fileMap: URI → { text(), exists } のレコード。テストが個別の URI に対する応答を制御できる
function makeMockExpoNewFS(opts: {
  // 各 URI に対する text() の戻り値マップ (省略可)
  textMap?: Record<string, string>;
  // 各 URI の exists プロパティのマップ (省略可、デフォルト true)
  existsMap?: Record<string, boolean>;
  // text() が rejected promise を返す場合のエラー (省略可)
  textError?: unknown;
  // Paths.document.uri (省略可)
  documentUri?: string;
  // Paths.cache.uri (省略可)
  cacheUri?: string;
  // Paths オブジェクト自体を省略するか
  omitPaths?: boolean;
}) {
  // text() / exists を vi.fn で記録できるよう File クラスを動的に生成
  const fileFactory = vi.fn();
  // File クラスのスパイ用コンストラクタ (アロー関数では new できないため class で定義)
  class MockFile {
    // 生成時にどの URI が渡されたかを記録する
    constructor(public uri: string) {
      // 呼び出し履歴を fileFactory に積む (assert で参照可能)
      fileFactory(uri);
    }
    // exists プロパティをマップから返す (未登録なら true)
    get exists(): boolean {
      return opts.existsMap?.[this.uri] ?? true;
    }
    // text() メソッドはマップから値を返す、もしくは textError で reject
    async text(): Promise<string> {
      if (opts.textError !== undefined) {
        throw opts.textError;
      }
      return opts.textMap?.[this.uri] ?? "content";
    }
  }
  // expo-file-system 風の名前空間オブジェクトを返す
  return {
    // File クラスを export
    File: MockFile,
    // Paths オブジェクト (省略時は undefined)
    Paths: opts.omitPaths
      ? undefined
      : {
          // document URI (指定なしなら既定値)
          document: opts.documentUri === undefined ? { uri: "file:///app/docs/" } : { uri: opts.documentUri },
          // cache URI
          cache: opts.cacheUri === undefined ? { uri: "file:///app/cache/" } : { uri: opts.cacheUri },
        },
    // テストから File 生成履歴を見られるようにエクスポートしておく
    _fileFactory: fileFactory,
  };
}

// 各テストの前にモジュールキャッシュと doMock 状態をリセットする
beforeEach(() => {
  // モジュールキャッシュをクリア
  vi.resetModules();
  // 既存のモックを解除
  vi.doUnmock("expo-file-system");
});

// createExpoBackend (新 File API、SDK 52+)
describe("createExpoBackend (新 File API)", () => {
  // 新 API モックで baseDir=document の解決を経て text() が呼ばれることを確認
  it("uses File class and Paths.document when baseDir is 'document'", async () => {
    // 新 API モックをセット
    const fs = makeMockExpoNewFS({ textMap: { "file:///app/docs/app.json": '{"v":1}' } });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    // document 指定
    const backend = createExpoBackend({ baseDir: "document" });
    // 読み出し
    const content = await backend.readFile("app.json");
    // File が "file:///app/docs/app.json" で生成された
    expect(fs._fileFactory).toHaveBeenCalledWith("file:///app/docs/app.json");
    // text() の戻りが返る
    expect(content).toBe('{"v":1}');
  });

  // baseDir=cache の場合は Paths.cache.uri が使われる
  it("uses Paths.cache when baseDir is 'cache'", async () => {
    // 新 API モックをセット
    const fs = makeMockExpoNewFS({});
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    // cache 指定
    const backend = createExpoBackend({ baseDir: "cache" });
    await backend.readFile("tmp.json");
    // Paths.cache.uri が使われている
    expect(fs._fileFactory).toHaveBeenCalledWith("file:///app/cache/tmp.json");
  });

  // exists を委譲できる (新 API の File.exists プロパティを使う)
  it("delegates exists() to File.exists property", async () => {
    // 新 API モック (a.json は exists=false に設定)
    const fs = makeMockExpoNewFS({ existsMap: { "file:///app/docs/a.json": false } });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    // document 指定
    const backend = createExpoBackend({ baseDir: "document" });
    // 結果が false
    expect(await backend.exists("a.json")).toBe(false);
  });

  // exists=false なら FILE_NOT_FOUND (新 API 経路)
  it("throws FILE_NOT_FOUND when File.exists is false (new API)", async () => {
    // 新 API モック (常に false)
    const fs = makeMockExpoNewFS({ existsMap: { "file:///app/docs/missing.json": false } });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    // document 指定
    const backend = createExpoBackend({ baseDir: "document" });
    // FILE_NOT_FOUND が飛ぶ
    await expect(backend.readFile("missing.json")).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  // text() が例外を投げたら IO_ERROR + cause (新 API 経路)
  it("wraps text() failure as IO_ERROR (new API)", async () => {
    // 新 API モック (text() が rejected)
    const fs = makeMockExpoNewFS({ textError: new Error("read fail") });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    // document 指定
    const backend = createExpoBackend({ baseDir: "document" });
    // 例外捕捉
    let caught: unknown;
    try {
      await backend.readFile("a.json");
    } catch (e) {
      caught = e;
    }
    // IO_ERROR + cause
    expect((caught as { code: string }).code).toBe("IO_ERROR");
    expect((caught as { cause: unknown }).cause).toBeInstanceOf(Error);
  });

  // 新 API で Paths が undefined のとき documentDirectory が null になり BACKEND_UNAVAILABLE
  it("throws BACKEND_UNAVAILABLE when Paths is undefined (new API, baseDir set)", async () => {
    // 新 API モックで Paths を省略
    const fs = makeMockExpoNewFS({ omitPaths: true });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    // document 指定でも Paths.document が無い
    const backend = createExpoBackend({ baseDir: "document" });
    // BACKEND_UNAVAILABLE が飛ぶ
    await expect(backend.readFile("a.json")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  // 新 API + baseDir 未指定 + 絶対 URI なら filePath をそのまま使う
  it("uses filePath as-is when baseDir is undefined (new API)", async () => {
    // 新 API モック
    const fs = makeMockExpoNewFS({});
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    // baseDir なし
    const backend = createExpoBackend();
    await backend.readFile("file:///custom/data.json");
    // 絶対 URI のまま File に渡される
    expect(fs._fileFactory).toHaveBeenCalledWith("file:///custom/data.json");
  });
});

// createExpoBackend (絶対 URI ガード)
describe("createExpoBackend (絶対 URI ガード)", () => {
  // file:// URI を指定したら baseDir を無視する
  it("ignores baseDir when filePath is file:// URI", async () => {
    // legacy API モック
    const fs = makeMockExpoFS();
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    // document 指定でも絶対 URI は尊重される
    const backend = createExpoBackend({ baseDir: "document" });
    await backend.readFile("file:///abs/path.json");
    // 元の URI のまま読み出される
    expect(fs.readAsStringAsync).toHaveBeenCalledWith("file:///abs/path.json");
  });

  // https:// URI を指定したら baseDir を無視する (将来の fetch 拡張を見越して)
  it("ignores baseDir when filePath is https:// URI", async () => {
    // legacy API モック
    const fs = makeMockExpoFS();
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    // document 指定でも https は絶対扱い
    const backend = createExpoBackend({ baseDir: "document" });
    await backend.readFile("https://example.com/config.json");
    // 元の URI のまま渡される
    expect(fs.readAsStringAsync).toHaveBeenCalledWith("https://example.com/config.json");
  });

  // content:// URI も同様 (Android のコンテンツプロバイダ)
  it("ignores baseDir when filePath is content:// URI (Android)", async () => {
    // legacy API モック
    const fs = makeMockExpoFS();
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    // document 指定でも content:// は絶対扱い
    const backend = createExpoBackend({ baseDir: "document" });
    await backend.readFile("content://media/external/file/123");
    // 元の URI のまま渡される
    expect(fs.readAsStringAsync).toHaveBeenCalledWith("content://media/external/file/123");
  });
});

// createExpoBackend (正常系)
describe("createExpoBackend (正常系)", () => {
  // baseDir 未指定なら filePath を絶対 URI として渡す
  it("uses filePath as-is when baseDir is undefined", async () => {
    // モック
    const fs = makeMockExpoFS();
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend();
    // 読み出し
    const content = await backend.readFile("file:///custom/path.json");
    expect(fs.readAsStringAsync).toHaveBeenCalledWith("file:///custom/path.json");
    expect(content).toBe("content");
  });

  // baseDir=document なら documentDirectory と結合する
  it("joins with documentDirectory when baseDir is 'document'", async () => {
    const fs = makeMockExpoFS();
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend({ baseDir: "document" });
    await backend.readFile("app.json");
    // documentDirectory の末尾スラッシュを保ったまま結合
    expect(fs.readAsStringAsync).toHaveBeenCalledWith("file:///app/docs/app.json");
  });

  // baseDir=cache なら cacheDirectory と結合する
  it("joins with cacheDirectory when baseDir is 'cache'", async () => {
    const fs = makeMockExpoFS();
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend({ baseDir: "cache" });
    await backend.readFile("tmp.json");
    expect(fs.readAsStringAsync).toHaveBeenCalledWith("file:///app/cache/tmp.json");
  });

  // ベース URI に末尾スラッシュが無いケースも正しく結合する
  it("appends slash when baseDir uri has no trailing slash", async () => {
    // 末尾スラッシュ無し URI
    const fs = makeMockExpoFS({ documentDirectory: "file:///app/docs" });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend({ baseDir: "document" });
    await backend.readFile("a.json");
    // 自動的にスラッシュが補われる
    expect(fs.readAsStringAsync).toHaveBeenCalledWith("file:///app/docs/a.json");
  });

  // filePath が先頭スラッシュ付きでも重複しない
  it("strips leading slash on relative path", async () => {
    const fs = makeMockExpoFS();
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend({ baseDir: "document" });
    // 先頭スラッシュ付き相対パス
    await backend.readFile("/a.json");
    // 重複スラッシュにならない
    expect(fs.readAsStringAsync).toHaveBeenCalledWith("file:///app/docs/a.json");
  });

  // exists を委譲して結果を返す
  it("delegates exists() to getInfoAsync", async () => {
    const fs = makeMockExpoFS({ getInfoAsync: vi.fn().mockResolvedValue({ exists: true }) });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend({ baseDir: "document" });
    expect(await backend.exists("a.json")).toBe(true);
    expect(fs.getInfoAsync).toHaveBeenCalledWith("file:///app/docs/a.json");
  });

  // default export がない (top-level エクスポート) ケースも受け付ける
  it("supports top-level exports (no default)", async () => {
    // default を含まないモック
    const fs = makeMockExpoFS();
    vi.doMock("expo-file-system", () => fs);
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend({ baseDir: "document" });
    expect(await backend.exists("a.json")).toBe(true);
  });
});

// createExpoBackend (エラー系)
describe("createExpoBackend (エラー系)", () => {
  // peerDep が未インストールなら BACKEND_UNAVAILABLE
  it("throws BACKEND_UNAVAILABLE when expo-file-system cannot be loaded", async () => {
    // 動的 import を失敗させる
    vi.doMock("expo-file-system", () => {
      throw new Error("Cannot find module 'expo-file-system'");
    });
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend();
    // BACKEND_UNAVAILABLE で拒否される
    await expect(backend.readFile("file:///a.json")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  // exists() でも BACKEND_UNAVAILABLE が伝播
  it("throws BACKEND_UNAVAILABLE from exists() as well", async () => {
    vi.doMock("expo-file-system", () => {
      throw new Error("Cannot find module 'expo-file-system'");
    });
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend();
    await expect(backend.exists("file:///a.json")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  // documentDirectory が null の環境では BACKEND_UNAVAILABLE
  it("throws BACKEND_UNAVAILABLE when documentDirectory is null (web)", async () => {
    // documentDirectory が null の FS (web ターゲットなど)
    const fs = makeMockExpoFS({ documentDirectory: null });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend({ baseDir: "document" });
    await expect(backend.readFile("a.json")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  // cacheDirectory が null の環境でも BACKEND_UNAVAILABLE
  it("throws BACKEND_UNAVAILABLE when cacheDirectory is null", async () => {
    const fs = makeMockExpoFS({ cacheDirectory: null });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend({ baseDir: "cache" });
    await expect(backend.readFile("a.json")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  // getInfoAsync が exists=false を返したら FILE_NOT_FOUND
  it("throws FILE_NOT_FOUND when file does not exist", async () => {
    const fs = makeMockExpoFS({ getInfoAsync: vi.fn().mockResolvedValue({ exists: false }) });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend({ baseDir: "document" });
    await expect(backend.readFile("missing.json")).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  // readAsStringAsync が例外を投げたら IO_ERROR + cause
  it("wraps readAsStringAsync failure as IO_ERROR", async () => {
    const fs = makeMockExpoFS({
      readAsStringAsync: vi.fn().mockRejectedValue(new Error("storage error")),
    });
    vi.doMock("expo-file-system", () => ({ default: fs }));
    const { createExpoBackend } = await import("./expo.js");
    const backend = createExpoBackend({ baseDir: "document" });
    // 例外捕捉
    let caught: unknown;
    try {
      await backend.readFile("a.json");
    } catch (e) {
      caught = e;
    }
    // IO_ERROR + cause
    expect((caught as { code: string }).code).toBe("IO_ERROR");
    expect((caught as { cause: unknown }).cause).toBeInstanceOf(Error);
  });
});
