// vitest の API を取り込む
import { beforeEach, describe, expect, it, vi } from "vitest";

// react-native-fs の最小モック型 (テスト内で型を絞るため)
interface MockRNFS {
  // ファイル読み出しの jest.fn 相当
  readFile: ReturnType<typeof vi.fn>;
  // 存在確認の jest.fn 相当
  exists: ReturnType<typeof vi.fn>;
  // 永続データディレクトリのパス
  DocumentDirectoryPath: string;
  // キャッシュディレクトリのパス
  CachesDirectoryPath: string;
}

// 既定値で MockRNFS を組み立てるヘルパ
function makeMockRNFS(overrides: Partial<MockRNFS> = {}): MockRNFS {
  // デフォルトの mock を返し、overrides で部分上書き可能
  return {
    // デフォルト: 文字列 "content" を返す
    readFile: overrides.readFile ?? vi.fn().mockResolvedValue("content"),
    // デフォルト: 常に true
    exists: overrides.exists ?? vi.fn().mockResolvedValue(true),
    // 永続データのパス
    DocumentDirectoryPath: overrides.DocumentDirectoryPath ?? "/docs",
    // キャッシュのパス
    CachesDirectoryPath: overrides.CachesDirectoryPath ?? "/cache",
  };
}

// 各テストの前にモジュールキャッシュと doMock 状態をリセットする
// (ESM の vi.doMock は resetModules してから動的 import する形が安定)
beforeEach(() => {
  // モジュールキャッシュをクリア (動的 import が新しい mock を引くようにする)
  vi.resetModules();
  // 既存のモックを解除 (テストごとに mock を再セットアップする)
  vi.doUnmock("react-native-fs");
});

// createRNFSBackend (正常系) の振る舞いを網羅するテスト
describe("createRNFSBackend (正常系)", () => {
  // baseDir 未指定なら filePath を絶対パスとして RNFS に渡す
  it("uses filePath as-is when baseDir is undefined", async () => {
    // RNFS をモック
    const rnfs = makeMockRNFS();
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    // 動的 import (mock 反映後)
    const { createRNFSBackend } = await import("./rnfs.js");
    // baseDir 未指定で生成
    const backend = createRNFSBackend();
    // 読み出し
    const content = await backend.readFile("/abs/path.json");
    // RNFS.readFile は元のパスのままで呼ばれる
    expect(rnfs.readFile).toHaveBeenCalledWith("/abs/path.json", "utf8");
    expect(content).toBe("content");
  });

  // baseDir=documents なら DocumentDirectoryPath と結合する
  it("joins with DocumentDirectoryPath when baseDir is 'documents'", async () => {
    // RNFS をモック
    const rnfs = makeMockRNFS();
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // documents 指定
    const backend = createRNFSBackend({ baseDir: "documents" });
    // 読み出し
    await backend.readFile("app.json");
    // /docs/app.json で呼ばれる
    expect(rnfs.readFile).toHaveBeenCalledWith("/docs/app.json", "utf8");
  });

  // baseDir=cache なら CachesDirectoryPath と結合する
  it("joins with CachesDirectoryPath when baseDir is 'cache'", async () => {
    // RNFS をモック
    const rnfs = makeMockRNFS();
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // cache 指定
    const backend = createRNFSBackend({ baseDir: "cache" });
    // 読み出し
    await backend.readFile("tmp.json");
    // /cache/tmp.json で呼ばれる
    expect(rnfs.readFile).toHaveBeenCalledWith("/cache/tmp.json", "utf8");
  });

  // 絶対パス (POSIX /...) を渡したら baseDir を無視する
  it("ignores baseDir when filePath is POSIX absolute (/)", async () => {
    // RNFS をモック
    const rnfs = makeMockRNFS();
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // documents 指定でも絶対パスは尊重される
    const backend = createRNFSBackend({ baseDir: "documents" });
    await backend.readFile("/abs/path.json");
    // /docs と結合せず元の /abs/path.json で呼ばれる
    expect(rnfs.readFile).toHaveBeenCalledWith("/abs/path.json", "utf8");
  });

  // Windows ドライブレター絶対パスでも baseDir を無視する
  it("ignores baseDir when filePath is Windows drive-letter absolute (C:\\)", async () => {
    // RNFS をモック
    const rnfs = makeMockRNFS();
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // documents 指定でも C:\ 始まりは絶対扱い
    const backend = createRNFSBackend({ baseDir: "documents" });
    await backend.readFile("C:\\Users\\app\\config.json");
    // 元のパスでそのまま呼ばれる
    expect(rnfs.readFile).toHaveBeenCalledWith("C:\\Users\\app\\config.json", "utf8");
  });

  // UNC バックスラッシュ絶対パスでも baseDir を無視する
  it("ignores baseDir when filePath is UNC (\\\\server\\share)", async () => {
    // RNFS をモック
    const rnfs = makeMockRNFS();
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // documents 指定でも UNC は絶対扱い
    const backend = createRNFSBackend({ baseDir: "documents" });
    await backend.readFile("\\\\server\\share\\app.json");
    // 元のパスでそのまま呼ばれる
    expect(rnfs.readFile).toHaveBeenCalledWith("\\\\server\\share\\app.json", "utf8");
  });

  // 末尾スラッシュ付きディレクトリパスも正規化される
  it("normalizes trailing slash in base directory", async () => {
    // 末尾スラッシュ付きパスを返す RNFS
    const rnfs = makeMockRNFS({ DocumentDirectoryPath: "/docs/" });
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // documents 指定
    const backend = createRNFSBackend({ baseDir: "documents" });
    // 読み出し
    await backend.readFile("app.json");
    // 重複スラッシュにならない
    expect(rnfs.readFile).toHaveBeenCalledWith("/docs/app.json", "utf8");
  });

  // Windows (RNW) で DocumentDirectoryPath が "C:\\Users\\..." 形式のとき
  // baseName を結合した結果も全体としてバックスラッシュ統一になる
  it("uses backslash separator when base path is Windows-style (RNW)", async () => {
    // RNW で実際に返るような Windows パスを設定
    const rnfs = makeMockRNFS({
      DocumentDirectoryPath: "C:\\Users\\app\\AppData\\Local\\Packages\\MyApp\\LocalState",
    });
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // documents 指定
    const backend = createRNFSBackend({ baseDir: "documents" });
    // 読み出し
    await backend.readFile("config.json");
    // バックスラッシュで一貫して結合される (POSIX "/" を混入させない)
    expect(rnfs.readFile).toHaveBeenCalledWith(
      "C:\\Users\\app\\AppData\\Local\\Packages\\MyApp\\LocalState\\config.json",
      "utf8",
    );
  });

  // Windows 風で末尾バックスラッシュ付きでも正規化される
  it("normalizes trailing backslash in Windows-style base path", async () => {
    // 末尾バックスラッシュ付きの Windows パス
    const rnfs = makeMockRNFS({ DocumentDirectoryPath: "C:\\Users\\app\\" });
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // documents 指定
    const backend = createRNFSBackend({ baseDir: "documents" });
    // 読み出し
    await backend.readFile("config.json");
    // 末尾バックスラッシュは除去され、改めてバックスラッシュで結合される
    expect(rnfs.readFile).toHaveBeenCalledWith("C:\\Users\\app\\config.json", "utf8");
  });

  // 区切り文字を含まないシンプルな base 名はフォワードスラッシュで結合される
  it("uses forward slash separator when base path has no separator at all", async () => {
    // 区切り文字なしの単純な名前
    const rnfs = makeMockRNFS({ DocumentDirectoryPath: "docs" });
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // documents 指定
    const backend = createRNFSBackend({ baseDir: "documents" });
    // 読み出し
    await backend.readFile("config.json");
    // デフォルトの / で結合
    expect(rnfs.readFile).toHaveBeenCalledWith("docs/config.json", "utf8");
  });

  // \\ と / が混在する base パスでは POSIX 区切り文字が優先される (フォールバック)
  it("falls back to forward slash when base path mixes both separators", async () => {
    // 混在パス (実用上はレアケース)
    const rnfs = makeMockRNFS({ DocumentDirectoryPath: "C:\\Users/app" });
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // documents 指定
    const backend = createRNFSBackend({ baseDir: "documents" });
    // 読み出し
    await backend.readFile("config.json");
    // POSIX 区切りで結合される
    expect(rnfs.readFile).toHaveBeenCalledWith("C:\\Users/app/config.json", "utf8");
  });

  // exists を委譲して結果を返す
  it("delegates exists() to RNFS", async () => {
    // exists が true を返すモック
    const rnfs = makeMockRNFS({ exists: vi.fn().mockResolvedValue(true) });
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    // documents 指定
    const backend = createRNFSBackend({ baseDir: "documents" });
    // 結果が true
    expect(await backend.exists("app.json")).toBe(true);
    // RNFS.exists も解決済みパスで呼ばれる
    expect(rnfs.exists).toHaveBeenCalledWith("/docs/app.json");
  });

  // default export がない (top-level エクスポート) ケースも受け付ける
  it("supports top-level exports (no default)", async () => {
    // default を含まない形でモック
    const rnfs = makeMockRNFS();
    vi.doMock("react-native-fs", () => rnfs);
    const { createRNFSBackend } = await import("./rnfs.js");
    // 通常通り使えるはず
    const backend = createRNFSBackend({ baseDir: "documents" });
    expect(await backend.exists("a.json")).toBe(true);
  });
});

// createRNFSBackend (エラー系) の振る舞いを網羅するテスト
describe("createRNFSBackend (エラー系)", () => {
  // peerDep が未インストールなら BACKEND_UNAVAILABLE
  it("throws BACKEND_UNAVAILABLE when react-native-fs cannot be loaded", async () => {
    // 動的 import を失敗させる (factory が throw すると import が rejected promise を返す)
    vi.doMock("react-native-fs", () => {
      throw new Error("Cannot find module 'react-native-fs'");
    });
    // 動的 import (こちらは rnfs.js 本体)
    const { createRNFSBackend } = await import("./rnfs.js");
    const backend = createRNFSBackend();
    // BACKEND_UNAVAILABLE で拒否される
    await expect(backend.readFile("/a.json")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  // exists() でも BACKEND_UNAVAILABLE が伝播
  it("throws BACKEND_UNAVAILABLE from exists() as well", async () => {
    // 動的 import 失敗
    vi.doMock("react-native-fs", () => {
      throw new Error("Cannot find module 'react-native-fs'");
    });
    const { createRNFSBackend } = await import("./rnfs.js");
    const backend = createRNFSBackend();
    // exists 経由でも BACKEND_UNAVAILABLE
    await expect(backend.exists("/a.json")).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  });

  // exists が false なら FILE_NOT_FOUND
  it("throws FILE_NOT_FOUND when file does not exist", async () => {
    // exists=false を返す RNFS
    const rnfs = makeMockRNFS({ exists: vi.fn().mockResolvedValue(false) });
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    const backend = createRNFSBackend({ baseDir: "documents" });
    // FILE_NOT_FOUND が飛ぶ
    await expect(backend.readFile("missing.json")).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  // readFile が例外を投げたら IO_ERROR + cause
  it("wraps RNFS readFile failure as IO_ERROR", async () => {
    // readFile が rejected promise を返すモック
    const rnfs = makeMockRNFS({
      readFile: vi.fn().mockRejectedValue(new Error("disk error")),
    });
    vi.doMock("react-native-fs", () => ({ default: rnfs }));
    const { createRNFSBackend } = await import("./rnfs.js");
    const backend = createRNFSBackend({ baseDir: "documents" });
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
