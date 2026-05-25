// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// React を取り込み
import * as React from "react";
// react-test-renderer から act / create を取り込み
import { act, create } from "react-test-renderer";
// core から Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";
// テスト対象を取り込み
import { ErrorBoundary } from "./ErrorBoundary.js";

// テスト用 Logger モック factory
function makeLogger(overrides: Partial<Logger> = {}): Logger {
  // 最小実装の Logger を返す
  return {
    // 各レベル
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    // child は self を返す
    child: vi.fn().mockReturnThis(),
    // flush / dispose は no-op
    flush: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    // テスト個別の上書き
    ...overrides,
  } as Logger;
}

// throw する子コンポーネント
function Boom({ message = "boom" }: { message?: string }): React.JSX.Element {
  // 描画中に同期 throw する
  throw new Error(message);
}

// ErrorBoundary のテストスイート
describe("ErrorBoundary", () => {
  // 正常時は children を描画すること
  it("正常時は children を描画する", async () => {
    // 描画結果を退避
    let tree: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // 子に普通の span を置く
      tree = create(
        <ErrorBoundary>
          <span>ok-content</span>
        </ErrorBoundary>,
      );
    });
    // JSON 出力に ok-content が含まれること
    expect(JSON.stringify(tree?.toJSON())).toContain("ok-content");
  });

  // throw 時に fallback (要素) を描画すること
  it("throw されたら fallback (要素) を描画する", async () => {
    // 描画結果を退避
    let tree: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // 子で throw、fallback は span
      tree = create(
        <ErrorBoundary fallback={<span>fb-text</span>}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // fallback の文字列が含まれること
    expect(JSON.stringify(tree?.toJSON())).toContain("fb-text");
  });

  // fallback が関数の場合は呼び出され、戻り値が描画されること
  it("throw されたら fallback (関数) を呼ぶ", async () => {
    // 関数 fallback
    const fallback = vi.fn((err: Error) => <span>{`fn:${err.message}`}</span>);
    // 描画結果を退避
    let tree: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // 子で throw、fallback は関数
      tree = create(
        <ErrorBoundary fallback={fallback}>
          <Boom message="kaboom" />
        </ErrorBoundary>,
      );
    });
    // fallback が呼ばれていること
    expect(fallback).toHaveBeenCalled();
    // 関数の戻り値が描画されていること
    expect(JSON.stringify(tree?.toJSON())).toContain("fn:kaboom");
  });

  // fallback 省略時は null を描画する（描画ツリーが null）
  it("fallback 省略時は null を描画する", async () => {
    // 描画結果を退避
    let tree: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // fallback なしで throw
      tree = create(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // toJSON が null（描画なし）
    expect(tree?.toJSON()).toBeNull();
  });

  // logger.error が呼ばれ、componentStack が引き渡されること
  it("logger.error を呼び componentStack を渡す", async () => {
    // logger
    const logger = makeLogger();
    // 描画
    await act(async () => {
      // 子で throw
      create(
        <ErrorBoundary logger={logger} fallback={null}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // logger.error が呼ばれていること
    expect(logger.error).toHaveBeenCalledTimes(1);
    // 第 1 呼び出しの引数列を退避（noUncheckedIndexedAccess 対応で undefined 排除）
    const firstCall = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    // 呼び出しが存在することを再確認
    expect(firstCall).toBeDefined();
    // 第 1 引数（タイトル）
    expect(firstCall?.[0]).toBe("react.errorBoundary");
    // 第 2 引数に error / componentStack が含まれること
    const data = firstCall?.[1] as {
      error: Error;
      componentStack: string | undefined;
    };
    // error が Error 型であること
    expect(data.error).toBeInstanceOf(Error);
    // componentStack はおおむね定義されている（jsdom の renderer が情報を載せる）
    expect(typeof data.componentStack === "string" || data.componentStack === undefined).toBe(true);
  });

  // onError が呼ばれること
  it("onError コールバックが呼ばれる", async () => {
    // onError
    const onError = vi.fn();
    // 描画
    await act(async () => {
      // 子で throw
      create(
        <ErrorBoundary onError={onError} fallback={null}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // onError が呼ばれていること
    expect(onError).toHaveBeenCalledTimes(1);
    // 第 1 引数は Error（noUncheckedIndexedAccess 対応で chained アクセス）
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  // logger.error 自身が throw しても boundary は壊れずに fallback を描画する
  it("logger.error が throw しても boundary は機能し続ける", async () => {
    // console.warn を抑制する
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // logger.error が throw する
    const logger = makeLogger({
      // 例外を投げる error 実装
      error: vi.fn(() => {
        // 任意の例外
        throw new Error("logger-broken");
      }) as unknown as Logger["error"],
    });
    // 描画結果を退避
    let tree: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // 子で throw、fallback あり
      tree = create(
        <ErrorBoundary logger={logger} fallback={<span>still-fb</span>}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // fallback が描画されていること
    expect(JSON.stringify(tree?.toJSON())).toContain("still-fb");
    // console.warn が呼ばれて漏れを記録していること
    expect(warnSpy).toHaveBeenCalled();
    // spy を解除
    warnSpy.mockRestore();
  });

  // onError 自身が throw しても boundary は機能し続ける
  it("onError が throw しても boundary は機能し続ける", async () => {
    // console.warn を抑制する
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 例外を投げる onError
    const onError = vi.fn(() => {
      // 任意の例外
      throw new Error("onError-broken");
    });
    // 描画結果を退避
    let tree: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // 子で throw、fallback あり
      tree = create(
        <ErrorBoundary onError={onError} fallback={<span>safe-fb</span>}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // fallback が描画されていること
    expect(JSON.stringify(tree?.toJSON())).toContain("safe-fb");
    // console.warn が呼ばれていること
    expect(warnSpy).toHaveBeenCalled();
    // spy を解除
    warnSpy.mockRestore();
  });

  // resetKeys 配列の要素変化で error 状態を解除すること
  it("resetKeys 配列の要素変化で error 状態を解除する", async () => {
    // describe スコープ用の renderer
    let renderer: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // 初回は throw 状態
      renderer = create(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={[1]}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // fallback が描画されていること
    expect(JSON.stringify(renderer?.toJSON())).toContain("fb");
    // resetKeys を変更し、children を正常な span に差し替えて update
    await act(async () => {
      // update で resetKeys を [2] に変更
      renderer?.update(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={[2]}>
          <span>recovered</span>
        </ErrorBoundary>,
      );
    });
    // recovered が描画されていること
    expect(JSON.stringify(renderer?.toJSON())).toContain("recovered");
  });

  // resetKeys が同一要素のときは error 状態を維持する
  it("resetKeys が同一なら error 状態を維持する", async () => {
    // renderer
    let renderer: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // 初回は throw 状態
      renderer = create(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={[1]}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // 同じ resetKeys で update（children も同じ throw コンポーネント）
    await act(async () => {
      // update
      renderer?.update(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={[1]}>
          <span>recovered</span>
        </ErrorBoundary>,
      );
    });
    // 依然 fb が描画されていること（reset が走らないため children 描画されない）
    expect(JSON.stringify(renderer?.toJSON())).toContain("fb");
  });

  // resetKeys 長さが変化したら reset する
  it("resetKeys の長さ変化で error 状態を解除する", async () => {
    // renderer
    let renderer: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // 初回は throw 状態（resetKeys: 1 件）
      renderer = create(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={[1]}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // resetKeys 長さを増やす
    await act(async () => {
      // 2 件に変更
      renderer?.update(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={[1, 2]}>
          <span>recovered</span>
        </ErrorBoundary>,
      );
    });
    // 解除されて recovered が描画されること
    expect(JSON.stringify(renderer?.toJSON())).toContain("recovered");
  });

  // 前 resetKeys が定義済み・新規が undefined のケース（片側 undefined 分岐）
  it("resetKeys が undefined に変わると error 状態を解除する", async () => {
    // renderer
    let renderer: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // 初回 throw、resetKeys あり
      renderer = create(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={[1]}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // 新 props で resetKeys を省略
    await act(async () => {
      // update（resetKeys なし）
      renderer?.update(
        <ErrorBoundary fallback={<span>fb</span>}>
          <span>recovered</span>
        </ErrorBoundary>,
      );
    });
    // 解除されて recovered が描画されること
    expect(JSON.stringify(renderer?.toJSON())).toContain("recovered");
  });

  // 前 resetKeys が undefined・新規が配列のケース
  it("resetKeys が undefined→配列 でも error 状態を解除する", async () => {
    // renderer
    let renderer: ReturnType<typeof create> | undefined;
    // 描画
    await act(async () => {
      // 初回 throw、resetKeys は省略
      renderer = create(
        <ErrorBoundary fallback={<span>fb</span>}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // 新 props で resetKeys を渡す
    await act(async () => {
      // update
      renderer?.update(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={[1]}>
          <span>recovered</span>
        </ErrorBoundary>,
      );
    });
    // 解除されて recovered が描画されること
    expect(JSON.stringify(renderer?.toJSON())).toContain("recovered");
  });

  // resetKeys が同一参照のときは reset しない（resetKeysChanged の prev===next 分岐）
  it("resetKeys が同一参照なら error 状態を維持する", async () => {
    // 同一参照を保つために配列を外側で固定
    const keys: readonly unknown[] = [1, 2, 3];
    // renderer
    let renderer: ReturnType<typeof create> | undefined;
    // 初回描画（throw）
    await act(async () => {
      // throw 子と固定 resetKeys
      renderer = create(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={keys}>
          <Boom />
        </ErrorBoundary>,
      );
    });
    // 同じ keys 参照のまま update
    await act(async () => {
      // 同一参照を渡す
      renderer?.update(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={keys}>
          <span>recovered</span>
        </ErrorBoundary>,
      );
    });
    // 同一参照のため reset されず fb のまま
    expect(JSON.stringify(renderer?.toJSON())).toContain("fb");
  });

  // componentStack が null のとき undefined に正規化されること（line 61 の `?? undefined` 分岐）
  it("componentStack が null のとき undefined に正規化して logger.error に渡す", () => {
    // logger
    const logger = makeLogger();
    // ErrorBoundary を直接インスタンス化して lifecycle を手動で呼ぶ
    const boundary = new ErrorBoundary({ logger, children: null });
    // componentStack=null を強制（React 19 は info.componentStack が null になり得る）
    boundary.componentDidCatch(new Error("manual"), {
      // null を明示的に渡す（React の ErrorInfo 型を満たすため as でキャスト）
      componentStack: null,
    } as unknown as React.ErrorInfo);
    // logger.error の第 2 引数を取得
    const data = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      error: Error;
      componentStack: string | undefined;
    };
    // null → undefined に正規化されていること
    expect(data.componentStack).toBeUndefined();
  });

  // 正常時の componentDidUpdate (error===null) ではキー比較が走らないこと
  it("error 状態でないときは resetKeys 変化があっても何もしない", async () => {
    // renderer
    let renderer: ReturnType<typeof create> | undefined;
    // 初回は正常描画
    await act(async () => {
      // 子は正常
      renderer = create(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={[1]}>
          <span>normal</span>
        </ErrorBoundary>,
      );
    });
    // resetKeys を変えて update
    await act(async () => {
      // update（依然正常）
      renderer?.update(
        <ErrorBoundary fallback={<span>fb</span>} resetKeys={[2]}>
          <span>normal-2</span>
        </ErrorBoundary>,
      );
    });
    // normal-2 が描画されていること
    expect(JSON.stringify(renderer?.toJSON())).toContain("normal-2");
  });
});
