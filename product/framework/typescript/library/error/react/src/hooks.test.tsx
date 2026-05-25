// React の要素型を読み込む
import type { ReactElement } from "react";
// React test renderer で Provider / hook / boundary を検証する
import { act, create } from "react-test-renderer";
// vitest のテスト API を読み込む
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// ErrorBoundary を読み込む
import { ErrorBoundary, withErrorBoundary } from "./ErrorBoundary.js";
// ErrorProvider を読み込む
import { ErrorProvider } from "./ErrorProvider.js";
// hook 群を読み込む
import { useAsyncErrorHandler, useErrorContext, useErrorHandler, useLastError } from "./hooks.js";

// useErrorHandler をテスト側へ渡すための補助コンポーネント
function Harness(props: { onReady: (api: ReturnType<typeof useErrorHandler>) => void }): ReactElement {
  // Provider から error handler を取得する
  const api = useErrorHandler();
  // テスト側へ handler を渡す
  props.onReady(api);
  // 描画自体は不要
  return null;
}

// lastError の kind を表示する補助コンポーネント
function LastErrorText(): ReactElement {
  // 最後の AppError を取得する
  const error = useLastError();
  // kind を検証しやすい形で描画する
  return <span>{error?.kind ?? "none"}</span>;
}

// async hook を検証する補助コンポーネント
function AsyncHarness(props: { onReady: (run: () => Promise<string | undefined>) => void }): ReactElement {
  // 失敗する async 関数を error handler で包む
  const run = useAsyncErrorHandler(async () => {
    throw Object.assign(new Error("Network down"), { code: "NETWORK_ERROR" });
  });
  // テスト側へ実行関数を渡す
  props.onReady(run);
  // 描画自体は不要
  return null;
}

// Provider 外利用のエラーを検証する補助コンポーネント
function OutsideProviderHarness(): ReactElement {
  // Provider 外なので throw される
  useErrorContext();
  // 到達しないが型のために null 相当を返す
  return <span>outside</span>;
}

// ErrorBoundary の fallback を検証するために必ず throw するコンポーネント
function ThrowingView(): ReactElement {
  // render 中に例外を投げる
  throw new Error("render failed");
}

// fallback component の描画を検証する補助コンポーネント
function BoundaryFallback(props: { error: { kind: string }; reset: () => void }): ReactElement {
  // kind と reset button を描画する
  return <button onClick={props.reset}>{props.error.kind}</button>;
}

// HOC の対象になる素朴なコンポーネント
function PlainView(): ReactElement {
  // HOC 経由で表示する文字列を返す
  return <span>wrapped</span>;
}

// React error boundary の console.error をテスト中だけ抑制する
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

// 各テスト前に React の境界ログを抑制する
beforeEach(() => {
  // 意図した throw の noise を消す
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// 各テスト後に console.error を戻す
afterEach(() => {
  // spy を解除する
  consoleErrorSpy.mockRestore();
});

// React binding の主要動作を検証する
describe("react error bindings", () => {
  // Provider の主要経路を検証する
  it("normalizes, logs, notifies, and stores errors", () => {
    // logger adapter を用意する
    const logger = { error: vi.fn() };
    // notification adapter を用意する
    const notification = { show: vi.fn() };
    // hook API を受け取る変数を用意する
    let api: ReturnType<typeof useErrorHandler> | undefined;

    // Provider 配下に補助コンポーネントを描画する
    const renderer = create(
      <ErrorProvider logger={logger} notification={notification}>
        <Harness onReady={(next) => (api = next)} />
        <LastErrorText />
      </ErrorProvider>,
    );

    // 403 エラーを処理する
    act(() => {
      api?.handleError({ status: 403, message: "Forbidden" });
    });

    // logger と notification が呼ばれることを検証する
    expect(logger.error).toHaveBeenCalledOnce();
    expect(notification.show).toHaveBeenCalledOnce();
    // lastError が更新されることを検証する
    expect(renderer.root.findByType("span").children).toEqual(["permission"]);
  });

  // notify/log 抑止と clearError を検証する
  it("supports silent handling and clearError", () => {
    // logger adapter を用意する
    const logger = { error: vi.fn() };
    // notification adapter を用意する
    const notification = { show: vi.fn() };
    // hook API を受け取る変数を用意する
    let api: ReturnType<typeof useErrorHandler> | undefined;

    // Provider を描画する
    const renderer = create(
      <ErrorProvider logger={logger} notification={notification}>
        <Harness onReady={(next) => (api = next)} />
        <LastErrorText />
      </ErrorProvider>,
    );

    // log / notify を抑止して処理する
    act(() => {
      api?.handleError(new Error("silent"), { log: false, notify: false, defaultKind: "business" });
    });

    // adapter が呼ばれないことを検証する
    expect(logger.error).not.toHaveBeenCalled();
    expect(notification.show).not.toHaveBeenCalled();
    expect(renderer.root.findByType("span").children).toEqual(["business"]);

    // lastError を clear する
    act(() => {
      api?.clearError();
    });

    // clear 後の表示を検証する
    expect(renderer.root.findByType("span").children).toEqual(["none"]);
  });

  // auth / permission callback を検証する
  it("calls auth and permission callbacks", () => {
    // auth callback を用意する
    const onUnauthorized = vi.fn();
    // permission callback を用意する
    const onForbidden = vi.fn();
    // hook API を受け取る変数を用意する
    let api: ReturnType<typeof useErrorHandler> | undefined;

    // Provider を描画する
    create(
      <ErrorProvider onUnauthorized={onUnauthorized} onForbidden={onForbidden}>
        <Harness onReady={(next) => (api = next)} />
      </ErrorProvider>,
    );

    // 401 と 403 を処理する
    act(() => {
      api?.handleError({ status: 401 });
      api?.handleError({ status: 403 });
    });

    // callback が kind ごとに呼ばれることを検証する
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onForbidden).toHaveBeenCalledOnce();
  });

  // async hook の失敗経路を検証する
  it("wraps async failures", async () => {
    // 実行関数を受け取る変数を用意する
    let run: (() => Promise<string | undefined>) | undefined;

    // Provider を描画する
    const renderer = create(
      <ErrorProvider>
        <AsyncHarness onReady={(next) => (run = next)} />
        <LastErrorText />
      </ErrorProvider>,
    );

    // async failure を処理する
    await act(async () => {
      await run?.();
    });

    // network error として保存されることを検証する
    expect(renderer.root.findByType("span").children).toEqual(["network"]);
  });

  // Provider 外利用時の明示的エラーを検証する
  it("throws a clear error outside provider", () => {
    // Provider 外の hook 利用は即時に失敗する
    expect(() => create(<OutsideProviderHarness />)).toThrow("useErrorHandler must be called inside <ErrorProvider>");
  });

  // ErrorBoundary の fallback と onError を検証する
  it("renders ErrorBoundary fallback and reports normalized errors", () => {
    // onError callback を用意する
    const onError = vi.fn();

    // 例外を投げる子を boundary で囲む
    const renderer = create(
      <ErrorBoundary fallback={BoundaryFallback} onError={onError} normalizeOptions={{ defaultKind: "system" }}>
        <ThrowingView />
      </ErrorBoundary>,
    );

    // fallback が表示されることを検証する
    expect(renderer.root.findByType("button").children).toEqual(["system"]);
    // onError に正規化済みエラーが渡ることを検証する
    expect(onError.mock.calls[0]?.[0].kind).toBe("system");
  });

  // ErrorBoundary の reset を検証する
  it("resets ErrorBoundary state", () => {
    // 子の throw を切り替えるフラグを用意する
    let shouldThrow = true;
    // 状態に応じて throw するコンポーネントを用意する
    function ToggleView(): ReactElement {
      // throw flag が有効なら失敗させる
      if (shouldThrow) {
        throw new Error("toggle failed");
      }
      // 成功時の表示を返す
      return <span>ok</span>;
    }

    // boundary を描画する
    const renderer = create(
      <ErrorBoundary fallback={BoundaryFallback}>
        <ToggleView />
      </ErrorBoundary>,
    );

    // fallback の reset を呼ぶ
    shouldThrow = false;
    act(() => {
      renderer.root.findByType("button").props.onClick();
    });

    // reset 後に子が表示されることを検証する
    expect(renderer.root.findByType("span").children).toEqual(["ok"]);
  });

  // withErrorBoundary の基本動作を検証する
  it("wraps components with ErrorBoundary", () => {
    // HOC を作成する
    const Wrapped = withErrorBoundary(PlainView);
    // displayName を検証する
    expect(Wrapped.displayName).toBe("withErrorBoundary(PlainView)");
    // wrapped component を描画する
    const renderer = create(<Wrapped />);
    // 元コンポーネントが表示されることを検証する
    expect(renderer.root.findByType("span").children).toEqual(["wrapped"]);
  });
});
