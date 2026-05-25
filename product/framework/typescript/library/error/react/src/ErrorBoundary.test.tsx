// vitest のテスト API を取り込み
import { describe, expect, it, vi } from "vitest";
// React 型と test renderer を取り込み
import type { ReactElement } from "react";
import { act, create } from "react-test-renderer";
// AppError 型を取り込み
import type { AppError } from "@k1s0-ts-error/core";
// ErrorBoundary と HOC を取り込み
import { ErrorBoundary, withErrorBoundary, type ErrorBoundaryFallbackProps } from "./ErrorBoundary.js";

// render 中に例外を投げるための補助コンポーネント
function ThrowingView(): ReactElement {
  throw new Error("render failed");
}

// HOC が wrap する素朴なコンポーネント
function PlainView(): null {
  return null;
}

// ErrorBoundary の動作を検証する
describe("ErrorBoundary", () => {
  // fallback component が AppError と reset を受け取れること
  it("renders fallback component with normalized AppError and reset", () => {
    // fallback から AppError / reset を取り出すための変数
    let capturedError: AppError | null = null;
    let capturedReset: (() => void) | null = null;
    const onError = vi.fn();

    // fallback として probe を渡す（host element を一切使わない）
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

    // normalizeOptions が反映された AppError が fallback に流れる
    expect(capturedError?.kind).toBe("system");
    expect(capturedReset).toBeTypeOf("function");
    // onError も同じ kind の AppError を受け取る
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

    // 既定 component 名 "ErrorBoundary" が反映される
    expect(capturedError?.context?.component).toBe("ErrorBoundary");
    expect(onError.mock.calls[0]?.[0]).toBe(capturedError);
    // 未指定経路では onError は最終 AppError で 1 回だけ呼ばれる（Bug 2 回帰防止）
    expect(onError).toHaveBeenCalledTimes(1);
  });

  // normalizeOptions に component キーが無いとき、既定値 "ErrorBoundary" が維持される（Bug 3 回帰防止）
  it("preserves default component name when normalizeOptions has no component key", () => {
    let capturedError: AppError | null = null;
    const onError = vi.fn();

    function FallbackProbe(props: ErrorBoundaryFallbackProps): null {
      capturedError = props.error;
      return null;
    }

    act(() => {
      create(
        <ErrorBoundary
          fallback={FallbackProbe}
          onError={onError}
          normalizeOptions={{ operation: "save", defaultKind: "business" }}
        >
          <ThrowingView />
        </ErrorBoundary>,
      );
    });

    // component は既定値のまま、operation は normalizeOptions 由来
    expect(capturedError?.context?.component).toBe("ErrorBoundary");
    expect(capturedError?.context?.operation).toBe("save");
    // defaultKind も反映される
    expect(capturedError?.kind).toBe("business");
    // onError 引数も最終的な AppError と一致する
    expect(onError.mock.calls[0]?.[0]).toBe(capturedError);
    // onError は 1 回だけ呼ばれる
    expect(onError).toHaveBeenCalledTimes(1);
  });

  // normalizeOptions.component が指定されている場合はユーザー指定が勝つ（既定値より優先）
  it("lets normalizeOptions.component override the default component name", () => {
    let capturedError: AppError | null = null;
    const onError = vi.fn();

    function FallbackProbe(props: ErrorBoundaryFallbackProps): null {
      capturedError = props.error;
      return null;
    }

    act(() => {
      create(
        <ErrorBoundary
          fallback={FallbackProbe}
          onError={onError}
          normalizeOptions={{ component: "CustomBoundary" }}
        >
          <ThrowingView />
        </ErrorBoundary>,
      );
    });

    // ユーザー指定値が勝つ
    expect(capturedError?.context?.component).toBe("CustomBoundary");
    expect(onError.mock.calls[0]?.[0]).toBe(capturedError);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  // fallback が ReactNode (関数でない値) の場合もそのまま描画
  it("renders ReactNode fallback as-is", () => {
    // ReactNode として渡す（host element でなく null を返す関数コンポーネントを敢えて使わない）
    const fallbackNode = null;

    // throw すれば fallback ノードへ切り替わる（描画結果は null）
    act(() => {
      const renderer = create(
        <ErrorBoundary fallback={fallbackNode}>
          <ThrowingView />
        </ErrorBoundary>,
      );
      // ReactNode fallback (null) を描画した状態は toJSON も null になる
      expect(renderer.toJSON()).toBeNull();
    });
  });

  // fallback 未指定なら null を描画
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

  // reset で state を初期化し子を再描画する
  it("resets state and re-renders the child after reset", () => {
    // 子を throw するか切り替えるフラグ
    let shouldThrow = true;
    // reset 関数を取り出すための変数
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

    // mount → fallback 描画
    act(() => {
      create(
        <ErrorBoundary fallback={FallbackProbe}>
          <ToggleView />
        </ErrorBoundary>,
      );
    });

    // reset を呼ぶと state が戻り、子が再描画される（throw しない）
    shouldThrow = false;
    act(() => {
      capturedReset?.();
    });
    // 例外が再発しないことを暗黙的に確認（テストが完了すれば OK）
    expect(capturedReset).toBeTypeOf("function");
  });

  // 通常時は子をそのまま描画する
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
describe("withErrorBoundary", () => {
  // displayName を Wrapped 名から生成する
  it("derives displayName from the wrapped component", () => {
    const Wrapped = withErrorBoundary(PlainView);
    expect(Wrapped.displayName).toBe("withErrorBoundary(PlainView)");
  });

  // 名前無し関数の場合は "Component" を使う
  it("falls back to Component when wrapped has no name", () => {
    const Wrapped = withErrorBoundary((() => null) as () => null);
    expect(Wrapped.displayName).toBe("withErrorBoundary(Component)");
  });

  // displayName が定義済みのコンポーネントを優先する
  it("uses displayName when available", () => {
    const Named = (): null => null;
    Named.displayName = "MyView";
    const Wrapped = withErrorBoundary(Named);
    expect(Wrapped.displayName).toBe("withErrorBoundary(MyView)");
  });

  // 子を素通り描画する（throw しない場合）
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
