// vitest DSL と react-test-renderer を取り込み
import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
// React の名前空間ごと取り込み（React.JSX.Element を使うため）
import * as React from "react";
import { useState } from "react";
// core の Manager 生成関数を取り込み
import { createNotificationManager } from "@k1s0-ts-notification/core";
// テスト対象とその依存
import { NotificationProvider } from "./NotificationProvider.js";
import { useHttpErrorHandler, type UseHttpErrorHandlerOptions } from "./errorHooks.js";

// react-native の Alert は本テストでは未使用だが、Node 環境で import を安全にするためモック
vi.mock("react-native", () => ({
  Alert: { alert: () => undefined },
}));

// useHttpErrorHandler の戻り値を観測する小さなコンポーネント
function HandlerProbe(props: {
  options?: UseHttpErrorHandlerOptions;
  onReady: (handler: (err: unknown) => string) => void;
}): null {
  // hook 経由で handler を取得
  const handler = useHttpErrorHandler(props.options ?? {});
  // 受け取り側に渡す（render ごとに呼ばれる）
  props.onReady(handler);
  // 描画なし
  return null;
}

describe("useHttpErrorHandler (react-native)", () => {
  // HttpErrorLike の経路：標準マッピングで toast が発行される
  it("HttpErrorLike を渡すと標準マッピング経由で toast が発行される", () => {
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    let handler: ((err: unknown) => string) | null = null;
    act(() => {
      create(
        <NotificationProvider manager={manager}>
          <HandlerProbe onReady={(h) => (handler = h)} />
        </NotificationProvider>,
      );
    });
    // 503 を投げる
    handler!({ message: "down", status: 503 });
    // toast 呼び出しと level が error
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]?.[0].level).toBe("error");
  });

  // fallback 経路：HttpErrorLike でない値は fallback または既定の error toast
  it("HttpErrorLike 以外は fallback もしくは既定の error toast を発行する", () => {
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    let handler: ((err: unknown) => string) | null = null;
    act(() => {
      create(
        <NotificationProvider manager={manager}>
          <HandlerProbe
            onReady={(h) => (handler = h)}
            options={{ fallback: (err) => ({ level: "warning", message: `wrapped:${String(err)}` }) }}
          />
        </NotificationProvider>,
      );
    });
    // 通常の Error を渡すと fallback 経由
    handler!(new Error("boom"));
    expect(toastSpy.mock.calls[0]?.[0].level).toBe("warning");
    expect(toastSpy.mock.calls[0]?.[0].message).toContain("wrapped:");
  });

  // fallback 未指定で HttpErrorLike 以外を渡したときの既定挙動
  it("fallback 未指定の場合は level:error の既定 toast を発行する", () => {
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    let handler: ((err: unknown) => string) | null = null;
    act(() => {
      create(
        <NotificationProvider manager={manager}>
          <HandlerProbe onReady={(h) => (handler = h)} />
        </NotificationProvider>,
      );
    });
    handler!(new Error("oops"));
    expect(toastSpy.mock.calls[0]?.[0].level).toBe("error");
    expect(toastSpy.mock.calls[0]?.[0].message).toBe("oops");
  });

  // fallback 未指定で Error 以外（文字列・数値など）を渡したときも String 化される
  it("fallback 未指定で Error 以外の値を渡しても String 化されて message になる", () => {
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    let handler: ((err: unknown) => string) | null = null;
    act(() => {
      create(
        <NotificationProvider manager={manager}>
          <HandlerProbe onReady={(h) => (handler = h)} />
        </NotificationProvider>,
      );
    });
    // 文字列を渡す（HttpErrorLike でも Error でもない）
    handler!("plain string error");
    expect(toastSpy.mock.calls[0]?.[0].level).toBe("error");
    expect(toastSpy.mock.calls[0]?.[0].message).toBe("plain string error");
  });

  // options を毎レンダリングで新規オブジェクトにしても handler 参照は同じ
  it("options を毎レンダリングで変えても handler 参照は安定する", () => {
    const manager = createNotificationManager();
    // render 制御用のステート（任意の値を変えるだけで再 render 誘発）
    const handlers: ((err: unknown) => string)[] = [];
    let triggerRerender: (() => void) | null = null;
    // 内部で setState を持つラッパ
    function Outer(): React.JSX.Element {
      const [count, setCount] = useState(0);
      triggerRerender = () => setCount((c) => c + 1);
      // count が変わるたびに options を新規オブジェクトで作る
      return (
        <NotificationProvider manager={manager}>
          <HandlerProbe
            options={{ duration: 1000 + count }}
            onReady={(h) => handlers.push(h)}
          />
        </NotificationProvider>
      );
    }
    act(() => {
      create(<Outer />);
    });
    // 再 render を 2 回誘発
    act(() => {
      triggerRerender!();
    });
    act(() => {
      triggerRerender!();
    });
    // 3 回ぶんの handler が同一参照であることを確認
    expect(handlers.length).toBeGreaterThanOrEqual(3);
    expect(handlers[0]).toBe(handlers[1]);
    expect(handlers[1]).toBe(handlers[2]);
  });

  // options の最新値が反映される（ref ベースで都度参照される）
  it("options を変えても handler 内部では最新値が参照される", () => {
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    // 切替対象の options を保持
    let triggerRerender: ((opts: UseHttpErrorHandlerOptions) => void) | null = null;
    let handler: ((err: unknown) => string) | null = null;
    function Outer(): React.JSX.Element {
      const [opts, setOpts] = useState<UseHttpErrorHandlerOptions>({ duration: 1000 });
      triggerRerender = setOpts;
      return (
        <NotificationProvider manager={manager}>
          <HandlerProbe options={opts} onReady={(h) => (handler = h)} />
        </NotificationProvider>
      );
    }
    act(() => {
      create(<Outer />);
    });
    // 最初は duration=1000
    handler!({ message: "x", status: 500 });
    expect(toastSpy.mock.calls[0]?.[0].duration).toBe(1000);
    // duration を 2000 に変える
    act(() => {
      triggerRerender!({ duration: 2000 });
    });
    handler!({ message: "y", status: 500 });
    expect(toastSpy.mock.calls[1]?.[0].duration).toBe(2000);
  });
});
