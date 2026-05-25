// vitest のテスト API を取り込み
import { describe, expect, it, vi } from "vitest";
// React test renderer を取り込み
import { act, create } from "react-test-renderer";
// AppError 型を取り込み
import type { AppError } from "@k1s0-ts-error/core";
// Provider と hook を取り込み
import { ErrorProvider } from "./ErrorProvider.js";
import { useErrorContext, useErrorHandler, useLastError } from "./hooks.js";

// useErrorHandler 結果を取り出す probe
function HandlerProbe(props: { onReady: (api: ReturnType<typeof useErrorHandler>) => void }): null {
  const api = useErrorHandler();
  props.onReady(api);
  return null;
}

// useLastError の値を取り出す probe
function LastErrorProbe(props: { onValue: (value: AppError | null) => void }): null {
  props.onValue(useLastError());
  return null;
}

// useErrorContext().normalize を取り出す probe
function NormalizeProbe(props: { onReady: (normalize: ReturnType<typeof useErrorContext>["normalize"]) => void }): null {
  const ctx = useErrorContext();
  props.onReady(ctx.normalize);
  return null;
}

// React Native binding の ErrorProvider 動作を検証する
describe("ErrorProvider (react-native)", () => {
  // 主要経路: 正規化 → ログ → 通知 → state 更新
  it("normalizes, logs, notifies, and stores lastError", () => {
    // adapter spy を用意
    const logger = { error: vi.fn() };
    const notification = { show: vi.fn() };
    // hook 結果と lastError を受け取る変数
    let api: ReturnType<typeof useErrorHandler> | undefined;
    let captured: AppError | null = null;

    act(() => {
      create(
        <ErrorProvider logger={logger} notification={notification}>
          <HandlerProbe onReady={(next) => (api = next)} />
          <LastErrorProbe onValue={(value) => (captured = value)} />
        </ErrorProvider>,
      );
    });

    // 403 を渡す
    act(() => {
      api?.handleError({ status: 403, message: "Forbidden" });
    });

    expect(logger.error).toHaveBeenCalledOnce();
    expect(notification.show).toHaveBeenCalledOnce();
    expect(captured?.kind).toBe("permission");
  });

  // log/notify 抑止 + clearError
  it("supports silent handling and clearError", () => {
    const logger = { error: vi.fn() };
    const notification = { show: vi.fn() };
    let api: ReturnType<typeof useErrorHandler> | undefined;
    let captured: AppError | null = null;

    act(() => {
      create(
        <ErrorProvider logger={logger} notification={notification}>
          <HandlerProbe onReady={(next) => (api = next)} />
          <LastErrorProbe onValue={(value) => (captured = value)} />
        </ErrorProvider>,
      );
    });

    act(() => {
      api?.handleError(new Error("silent"), { log: false, notify: false, defaultKind: "business" });
    });

    expect(logger.error).not.toHaveBeenCalled();
    expect(notification.show).not.toHaveBeenCalled();
    expect(captured?.kind).toBe("business");

    act(() => {
      api?.clearError();
    });
    expect(captured).toBeNull();
  });

  // auth / permission コールバック
  it("invokes auth and permission callbacks based on kind", () => {
    const onUnauthorized = vi.fn();
    const onForbidden = vi.fn();
    const onError = vi.fn();
    let api: ReturnType<typeof useErrorHandler> | undefined;

    act(() => {
      create(
        <ErrorProvider onUnauthorized={onUnauthorized} onForbidden={onForbidden} onError={onError}>
          <HandlerProbe onReady={(next) => (api = next)} />
        </ErrorProvider>,
      );
    });

    act(() => {
      api?.handleError({ status: 401 });
      api?.handleError({ status: 403 });
      api?.handleError({ status: 500 });
    });

    expect(onError).toHaveBeenCalledTimes(3);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onForbidden).toHaveBeenCalledOnce();
  });

  // normalize 関数だけを使う経路
  it("exposes a side-effect-free normalize helper", () => {
    const logger = { error: vi.fn() };
    let normalize: ReturnType<typeof useErrorContext>["normalize"] | undefined;

    act(() => {
      create(
        <ErrorProvider logger={logger}>
          <NormalizeProbe onReady={(fn) => (normalize = fn)} />
        </ErrorProvider>,
      );
    });

    const result = normalize?.(new Error("standalone"), { operation: "x" });
    expect(result?.context?.operation).toBe("x");
    expect(logger.error).not.toHaveBeenCalled();
  });
});
