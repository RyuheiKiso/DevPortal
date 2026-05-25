// vitest のテスト API を取り込み
import { afterEach, describe, expect, it, vi } from "vitest";
// React Native global handler 連携を取り込み
import { registerNativeGlobalErrorHandler, type NativeErrorUtilsLike } from "./nativeGlobalHandler.js";

// ErrorUtils 互換の fake を作成するヘルパ
// previous 指定で「既存 handler を持つ」「持たない」両方の状況を作れる
function createErrorUtils(
  previous?: (error: unknown, isFatal?: boolean) => void,
  options: { withGetGlobalHandler?: boolean } = { withGetGlobalHandler: true },
): NativeErrorUtilsLike & {
  current?: (error: unknown, isFatal?: boolean) => void;
} {
  // 現在の handler を保持する内部 state
  let current = previous;
  // fake ErrorUtils 本体を組み立て
  const base = {
    // 現在の handler を返すためのアクセサ
    get current() {
      return current;
    },
    // setGlobalHandler は引数を保持
    setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => {
      current = handler;
    },
  };
  // withGetGlobalHandler=true なら getGlobalHandler を生やす
  if (options.withGetGlobalHandler !== false) {
    return Object.assign(base, { getGlobalHandler: () => current });
  }
  // withGetGlobalHandler=false なら省略 (previous 解決が undefined になる経路を作る)
  return base;
}

// globalThis.ErrorUtils を毎テスト後に綺麗にする
afterEach(() => {
  // 検証中に globalThis に挿した ErrorUtils を片付ける
  delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
});

// React Native global error handler の動作を検証する
describe("registerNativeGlobalErrorHandler", () => {
  // ErrorUtils が無ければ即座に明示エラー
  it("throws when ErrorUtils is unavailable", () => {
    expect(() =>
      registerNativeGlobalErrorHandler({
        onError: () => undefined,
      }),
    ).toThrow("React Native ErrorUtils is not available");
  });

  // globalThis.ErrorUtils 経路: 明示渡し無しで global を解決する
  it("resolves ErrorUtils from globalThis when not passed explicitly", () => {
    // globalThis に ErrorUtils を仕込む
    const errorUtils = createErrorUtils();
    (globalThis as { ErrorUtils?: NativeErrorUtilsLike }).ErrorUtils = errorUtils;

    const onError = vi.fn();
    const restore = registerNativeGlobalErrorHandler({ onError });

    // 仕込んだ handler を呼ぶと onError に流れる
    errorUtils.current?.(new Error("from global"), false);
    expect(onError).toHaveBeenCalledOnce();

    // restore で previous (今回は undefined) に戻る → noop
    restore();
    expect(errorUtils.current).toBeDefined();
  });

  // handler 登録 + 正規化 + isFatal 透過
  it("registers a global handler and normalizes fatal errors", () => {
    const errorUtils = createErrorUtils();
    const onError = vi.fn();

    const restore = registerNativeGlobalErrorHandler({
      errorUtils,
      normalizeOptions: { defaultKind: "system" },
      onError,
    });

    // 例外を渡して isFatal=true を通す
    errorUtils.current?.(new Error("native failed"), true);

    expect(onError.mock.calls[0]?.[0].kind).toBe("system");
    expect(onError.mock.calls[0]?.[1]).toBe(true);

    // restore は previous なしでも noop で安全
    restore();
  });

  // isFatal 省略時は false に解決される
  it("defaults isFatal to false when omitted", () => {
    const errorUtils = createErrorUtils();
    const onError = vi.fn();

    registerNativeGlobalErrorHandler({ errorUtils, onError });

    // isFatal を省略して呼ぶ
    errorUtils.current?.(new Error("non-fatal"));

    expect(onError.mock.calls[0]?.[1]).toBe(false);
  });

  // callPrevious=true: previous handler にも引き渡す
  it("calls previous handler when callPrevious is true", () => {
    const previous = vi.fn();
    const errorUtils = createErrorUtils(previous);
    const onError = vi.fn();

    const restore = registerNativeGlobalErrorHandler({
      errorUtils,
      onError,
      callPrevious: true,
    });

    const thrown = Object.assign(new Error("network failed"), { code: "NETWORK_ERROR" });
    errorUtils.current?.(thrown, false);

    expect(onError.mock.calls[0]?.[0].kind).toBe("network");
    expect(previous).toHaveBeenCalledWith(thrown, false);

    // restore で previous に戻る
    restore();
    expect(errorUtils.current).toBe(previous);
  });

  // callPrevious=false (省略): previous handler は呼ばれない
  it("does not call previous handler when callPrevious is omitted", () => {
    const previous = vi.fn();
    const errorUtils = createErrorUtils(previous);
    const onError = vi.fn();

    registerNativeGlobalErrorHandler({ errorUtils, onError });

    errorUtils.current?.(new Error("isolated"), false);

    expect(onError).toHaveBeenCalledOnce();
    expect(previous).not.toHaveBeenCalled();
  });

  // getGlobalHandler 未提供の ErrorUtils でも動作する
  it("works when ErrorUtils does not provide getGlobalHandler", () => {
    const errorUtils = createErrorUtils(undefined, { withGetGlobalHandler: false });
    const onError = vi.fn();

    const restore = registerNativeGlobalErrorHandler({ errorUtils, onError });

    errorUtils.current?.(new Error("no previous"), false);
    expect(onError).toHaveBeenCalledOnce();

    // previous が解決されないので restore は noop（current は最後に設定された handler のまま）
    const beforeRestore = errorUtils.current;
    restore();
    expect(errorUtils.current).toBe(beforeRestore);
  });
});
