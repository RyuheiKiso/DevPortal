// vitest のテスト API を取り込み
import { describe, expect, it, vi } from "vitest";
// React test renderer を取り込み
import { act, create } from "react-test-renderer";
// AppError 型を取り込み
import type { AppError } from "@k1s0-ts-error/core";
// Provider と hook を取り込み
import { ErrorProvider } from "./ErrorProvider.js";
import { useErrorContext, useErrorHandler, useLastError } from "./hooks.js";

// Provider 配下から useErrorHandler を取り出すための probe
function HandlerProbe(props: { onReady: (api: ReturnType<typeof useErrorHandler>) => void }): null {
  const api = useErrorHandler();
  props.onReady(api);
  return null;
}

// Provider 配下から useLastError を取り出すための probe
function LastErrorProbe(props: { onValue: (value: AppError | null) => void }): null {
  const value = useLastError();
  props.onValue(value);
  return null;
}

// Provider 配下から normalize 関数を取り出すための probe
function NormalizeProbe(props: { onReady: (normalize: ReturnType<typeof useErrorContext>["normalize"]) => void }): null {
  const ctx = useErrorContext();
  props.onReady(ctx.normalize);
  return null;
}

// ErrorProvider の動作を検証する
describe("ErrorProvider", () => {
  // 主要経路: 正規化 → ログ → 通知 → state 更新
  it("normalizes, logs, notifies, and stores lastError", () => {
    // adapter spy を用意
    const logger = { error: vi.fn() };
    const notification = { show: vi.fn() };
    // hook 結果と lastError を受け取る変数を用意
    let api: ReturnType<typeof useErrorHandler> | undefined;
    let captured: AppError | null = null;

    // Provider を act 内で mount
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

    // logger / notification が呼ばれることを確認
    expect(logger.error).toHaveBeenCalledOnce();
    expect(notification.show).toHaveBeenCalledOnce();
    // lastError 経路で permission として保持されることを確認
    expect(captured?.kind).toBe("permission");
  });

  // log/notify 抑止と clearError
  it("supports silent handling and clearError", () => {
    // adapter spy を用意
    const logger = { error: vi.fn() };
    const notification = { show: vi.fn() };
    // hook 結果と lastError を受け取る変数を用意
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

    // log:false / notify:false を指定して呼ぶ
    act(() => {
      api?.handleError(new Error("silent"), { log: false, notify: false, defaultKind: "business" });
    });

    // adapter が呼ばれないことを確認
    expect(logger.error).not.toHaveBeenCalled();
    expect(notification.show).not.toHaveBeenCalled();
    expect(captured?.kind).toBe("business");

    // clearError で null に戻ることを確認
    act(() => {
      api?.clearError();
    });
    expect(captured).toBeNull();
  });

  // auth / permission 系コールバックの分岐
  it("invokes auth and permission callbacks based on kind", () => {
    // callback spy を用意
    const onUnauthorized = vi.fn();
    const onForbidden = vi.fn();
    const onError = vi.fn();
    // hook 結果を受け取る変数を用意
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

    // onError は毎回呼ばれる
    expect(onError).toHaveBeenCalledTimes(3);
    // auth / permission は kind 一致時のみ
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onForbidden).toHaveBeenCalledOnce();
  });

  // normalize 関数だけを取り出して副作用なしで使う経路
  it("exposes a side-effect-free normalize helper", () => {
    // adapter spy を用意（呼ばれないことを確認）
    const logger = { error: vi.fn() };
    let normalize: ReturnType<typeof useErrorContext>["normalize"] | undefined;

    act(() => {
      create(
        <ErrorProvider logger={logger}>
          <NormalizeProbe onReady={(fn) => (normalize = fn)} />
        </ErrorProvider>,
      );
    });

    // normalize は副作用無しで AppError を返す
    const result = normalize?.(new Error("standalone"), { operation: "x" });
    expect(result?.context?.operation).toBe("x");
    // logger は呼ばれない（normalize 経路は副作用無し）
    expect(logger.error).not.toHaveBeenCalled();
  });
});
