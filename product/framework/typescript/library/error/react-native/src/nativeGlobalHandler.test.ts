// vitest のテスト API を読み込む
import { describe, expect, it, vi } from "vitest";
// React Native global handler 連携を読み込む
import { registerNativeGlobalErrorHandler, type NativeErrorUtilsLike } from "./nativeGlobalHandler.js";

// ErrorUtils 互換の fake を作成する
function createErrorUtils(previous?: (error: unknown, isFatal?: boolean) => void): NativeErrorUtilsLike & {
  current?: (error: unknown, isFatal?: boolean) => void;
} {
  // 現在の handler を保持する
  let current = previous;
  // fake ErrorUtils を返す
  return {
    // 現在の handler を返す
    get current() {
      return current;
    },
    // 既存 handler を返す
    getGlobalHandler: () => current,
    // 新しい handler を保存する
    setGlobalHandler: (handler) => {
      current = handler;
    },
  };
}

// React Native global error handler の動作を検証する
describe("registerNativeGlobalErrorHandler", () => {
  // ErrorUtils がない環境の明示的エラーを検証する
  it("throws when ErrorUtils is unavailable", () => {
    // ErrorUtils 未指定かつ global にもない場合は失敗する
    expect(() =>
      registerNativeGlobalErrorHandler({
        onError: () => undefined,
      }),
    ).toThrow("React Native ErrorUtils is not available");
  });

  // handler 登録と正規化を検証する
  it("registers a global handler and normalizes fatal errors", () => {
    // fake ErrorUtils を用意する
    const errorUtils = createErrorUtils();
    // onError spy を用意する
    const onError = vi.fn();

    // global handler を登録する
    const restore = registerNativeGlobalErrorHandler({
      errorUtils,
      normalizeOptions: { defaultKind: "system" },
      onError,
    });

    // 登録された handler を呼び出す
    errorUtils.current?.(new Error("native failed"), true);

    // onError に AppError と fatal flag が渡ることを検証する
    expect(onError.mock.calls[0]?.[0].kind).toBe("system");
    expect(onError.mock.calls[0]?.[1]).toBe(true);

    // previous がない場合の restore は何もしない
    restore();
    expect(errorUtils.current).toBeDefined();
  });

  // 既存 handler 呼び出しと restore を検証する
  it("can call and restore the previous handler", () => {
    // previous handler を用意する
    const previous = vi.fn();
    // previous 付き fake ErrorUtils を用意する
    const errorUtils = createErrorUtils(previous);
    // onError spy を用意する
    const onError = vi.fn();

    // previous 呼び出し付きで登録する
    const restore = registerNativeGlobalErrorHandler({
      errorUtils,
      onError,
      callPrevious: true,
    });

    // 登録された handler を呼び出す
    const thrown = Object.assign(new Error("network failed"), { code: "NETWORK_ERROR" });
    errorUtils.current?.(thrown, false);

    // 正規化結果と previous 呼び出しを検証する
    expect(onError.mock.calls[0]?.[0].kind).toBe("network");
    expect(previous).toHaveBeenCalledWith(thrown, false);

    // restore で previous handler に戻ることを検証する
    restore();
    expect(errorUtils.current).toBe(previous);
  });
});
