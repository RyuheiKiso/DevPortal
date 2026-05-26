// vitest の API を取り込む
import { beforeEach, describe, expect, it, vi } from "vitest";

// 各テスト前にモジュールキャッシュをリセット
beforeEach(() => {
  // モジュールキャッシュをクリア
  vi.resetModules();
  // 既存モックを解除
  vi.doUnmock("react-native-fs");
});

// createRNFSLoader の振る舞いを網羅するテスト
describe("createRNFSLoader", () => {
  // バックエンドファクトリ経由で Loader が組み立てられることを確認
  it("returns a Loader that delegates to RNFS backend", async () => {
    // RNFS をモック
    vi.doMock("react-native-fs", () => ({
      default: {
        // JSON 文字列を返す
        readFile: vi.fn().mockResolvedValue('{"env":"dev"}'),
        // 常に exists=true
        exists: vi.fn().mockResolvedValue(true),
        // 各種ディレクトリパス
        DocumentDirectoryPath: "/docs",
        CachesDirectoryPath: "/cache",
      },
    }));
    // 動的 import (mock 反映後)
    const { createRNFSLoader } = await import("./rnfsLoader.js");
    // documents ベースで生成
    const loader = createRNFSLoader({ baseDir: "documents" });
    // ロードできる
    const v = (await loader.loadConfig("app.json")) as { env: string };
    expect(v.env).toBe("dev");
  });

  // createRNFSBackend を直接 export していることを確認
  it("re-exports createRNFSBackend", async () => {
    // mock セットアップ
    vi.doMock("react-native-fs", () => ({
      default: {
        readFile: vi.fn().mockResolvedValue("{}"),
        exists: vi.fn().mockResolvedValue(true),
        DocumentDirectoryPath: "/docs",
        CachesDirectoryPath: "/cache",
      },
    }));
    // index 経由で取れることを確認
    const mod = await import("./index.js");
    // 関数として export されている
    expect(typeof mod.createRNFSBackend).toBe("function");
    expect(typeof mod.createRNFSLoader).toBe("function");
  });
});
