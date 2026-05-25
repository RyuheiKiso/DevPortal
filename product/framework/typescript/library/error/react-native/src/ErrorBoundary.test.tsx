// vitest のテスト API を取り込み
import { describe, expect, it, vi } from "vitest";
// React 型と test renderer を取り込み
import type { ReactElement } from "react";
import { act, create } from "react-test-renderer";
// AppError 型を取り込み
import type { AppError } from "@k1s0-ts-error/core";
// ErrorBoundary と HOC を取り込み
import { ErrorBoundary, withErrorBoundary, type ErrorBoundaryFallbackProps } from "./ErrorBoundary.js";

// render 中に例外を投げる補助コンポーネント
function ThrowingView(): ReactElement {
  throw new Error("render failed");
}

// HOC が wrap する素朴なコンポーネント
function PlainView(): null {
  return null;
}

// ErrorBoundary の動作を検証する（React Native binding）
describe("ErrorBoundary (react-native)", () => {
  // fallback component が AppError と reset を受け取れる
  it("renders fallback component with normalized AppError and reset", () => {
    let capturedError: AppError | null = null;
    let capturedReset: (() => void) | null = null;
    const onError = vi.fn();

    function FallbackProbe(props: ErrorBoundaryFallbackProps): null {
      capturedError = props.error;
      capturedReset = props.reset;
      return null;
    }

    act(() => {
      create(
        <ErrorBoundary fallback={FallbackProbe} onError={onError} normalizeOptions={{ defaultKind: "system" }}>
          <ThrowingView />
        </ErrorBoundary>,
      );
    });

    expect(capturedError?.kind).toBe("system");
    expect(capturedReset).toBeTypeOf("function");
    expect(onError.mock.calls[0]?.[0].kind).toBe("system");
  });

  // normalizeOptions 未指定でも fallback と onError は動く
  it("calls onError with the default-normalized AppError when normalizeOptions is omitted", () => {
    let capturedError: AppError | null = null;
    const onError = vi.fn();

    function FallbackProbe(props: ErrorBoundaryFallbackProps): null {
      capturedError = props.error;
      return null;
    }

    act(() => {
      create(
        <ErrorBoundary fallback={FallbackProbe} onError={onError}>
          <ThrowingView />
        </ErrorBoundary>,
      );
    });

    expect(capturedError?.context?.component).toBe("ErrorBoundary");
    expect(onError.mock.calls[0]?.[0]).toBe(capturedError);
  });

  // fallback が ReactNode (null) のまま素通し描画
  it("renders ReactNode fallback as-is", () => {
    act(() => {
      const renderer = create(
        <ErrorBoundary fallback={null}>
          <ThrowingView />
        </ErrorBoundary>,
      );
      expect(renderer.toJSON()).toBeNull();
    });
  });

  // fallback 未指定なら null 描画
  it("renders null when fallback is undefined", () => {
    act(() => {
      const renderer = create(
        <ErrorBoundary>
          <ThrowingView />
        </ErrorBoundary>,
      );
      expect(renderer.toJSON()).toBeNull();
    });
  });

  // reset で state を初期化する
  it("resets state and re-renders the child after reset", () => {
    let shouldThrow = true;
    let capturedReset: (() => void) | null = null;

    function ToggleView(): null {
      if (shouldThrow) {
        throw new Error("toggle failed");
      }
      return null;
    }

    function FallbackProbe(props: ErrorBoundaryFallbackProps): null {
      capturedReset = props.reset;
      return null;
    }

    act(() => {
      create(
        <ErrorBoundary fallback={FallbackProbe}>
          <ToggleView />
        </ErrorBoundary>,
      );
    });

    shouldThrow = false;
    act(() => {
      capturedReset?.();
    });

    expect(capturedReset).toBeTypeOf("function");
  });

  // 通常時は子を描画
  it("renders children when no error has occurred", () => {
    let probeCalled = false;
    function ChildProbe(): null {
      probeCalled = true;
      return null;
    }

    act(() => {
      create(
        <ErrorBoundary>
          <ChildProbe />
        </ErrorBoundary>,
      );
    });

    expect(probeCalled).toBe(true);
  });
});

// withErrorBoundary HOC の動作を検証する
describe("withErrorBoundary (react-native)", () => {
  // displayName を Wrapped 名から生成する
  it("derives displayName from the wrapped component", () => {
    const Wrapped = withErrorBoundary(PlainView);
    expect(Wrapped.displayName).toBe("withErrorBoundary(PlainView)");
  });

  // 名前無しの匿名関数は "Component" を使う
  it("falls back to Component when wrapped has no name", () => {
    const Wrapped = withErrorBoundary((() => null) as () => null);
    expect(Wrapped.displayName).toBe("withErrorBoundary(Component)");
  });

  // displayName 優先
  it("uses displayName when available", () => {
    const Named = (): null => null;
    Named.displayName = "MyView";
    const Wrapped = withErrorBoundary(Named);
    expect(Wrapped.displayName).toBe("withErrorBoundary(MyView)");
  });

  // 子を素通り描画する
  it("renders wrapped component when child does not throw", () => {
    let called = false;
    function HookView(): null {
      called = true;
      return null;
    }
    const Wrapped = withErrorBoundary(HookView);

    act(() => {
      create(<Wrapped />);
    });

    expect(called).toBe(true);
  });
});
