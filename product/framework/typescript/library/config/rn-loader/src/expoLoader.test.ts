// vitest の API を取り込む
import { beforeEach, describe, expect, it, vi } from "vitest";

// 各テスト前にモジュールキャッシュをリセット
beforeEach(() => {
  // モジュールキャッシュをクリア
  vi.resetModules();
  // 既存モックを解除
  vi.doUnmock("expo-file-system");
});

// createExpoLoader の振る舞いを網羅するテスト
describe("createExpoLoader", () => {
  // バックエンドファクトリ経由で Loader が組み立てられることを確認
  it("returns a Loader that delegates to Expo backend", async () => {
    // Expo FS をモック
    vi.doMock("expo-file-system", () => ({
      default: {
        // JSON 文字列を返す
        readAsStringAsync: vi.fn().mockResolvedValue('{"env":"staging"}'),
        // exists=true
        getInfoAsync: vi.fn().mockResolvedValue({ exists: true }),
        // URI 形式のディレクトリ
        documentDirectory: "file:///app/docs/",
        cacheDirectory: "file:///app/cache/",
      },
    }));
    // 動的 import
    const { createExpoLoader } = await import("./expoLoader.js");
    // document ベースで生成
    const loader = createExpoLoader({ baseDir: "document" });
    // ロード結果確認
    const v = (await loader.loadConfig("app.json")) as { env: string };
    expect(v.env).toBe("staging");
  });

  // createExpoBackend を直接 export していることを確認
  it("re-exports createExpoBackend", async () => {
    // mock セットアップ
    vi.doMock("expo-file-system", () => ({
      default: {
        readAsStringAsync: vi.fn().mockResolvedValue("{}"),
        getInfoAsync: vi.fn().mockResolvedValue({ exists: true }),
        documentDirectory: "file:///app/docs/",
        cacheDirectory: "file:///app/cache/",
      },
    }));
    // index 経由で取れること
    const mod = await import("./index.js");
    // 関数として export されている
    expect(typeof mod.createExpoBackend).toBe("function");
    expect(typeof mod.createExpoLoader).toBe("function");
  });
});
