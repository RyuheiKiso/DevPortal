// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// React を取り込み
import * as React from "react";
// react-test-renderer から act / create を取り込み
import { act, create } from "react-test-renderer";
// core から Logger 型と LoggerBindings 型を取り込み
import type { Logger, LoggerBindings } from "@k1s0-ts-logger/core";
// テスト対象 hooks を取り込み
import { useLogger, useScopedLogger } from "./hooks.js";
// Provider を取り込み
import { LoggerProvider } from "./LoggerProvider.js";

// Logger モックを作る factory。child() で identity をつけた別インスタンスを返す
function makeLogger(label = "root"): Logger {
  // 最小限の Logger を返す（label をプロパティに混ぜることで identity を判別可能）
  const logger = {
    // 各レベル
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    // child を呼ぶたびに新しい mock logger を返す（identity 検証用）
    child: vi.fn((bindings: LoggerBindings) => {
      // bindings の一部を label に含めることで child 識別ができるようにする
      const childLabel = `${label}>child(${bindings.tags?.join(",") ?? ""}|${
        Object.keys(bindings.context ?? {}).length
      })`;
      // 再帰的に最小 Logger を生成
      return makeLogger(childLabel);
    }) as unknown as Logger["child"],
    // flush / dispose は no-op
    flush: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    // 識別用の追加プロパティ
    __label: label,
  };
  // Logger 型へキャストして返す
  return logger as unknown as Logger;
}

// hook の戻り値を観察するための Probe を作る
function makeProbe<T>(target: { current: T | undefined }, useHook: () => T) {
  // 戻り値を退避する関数コンポーネントを返す
  return function Probe(): React.JSX.Element {
    // hook を呼び戻り値を退避する
    target.current = useHook();
    // 描画は空
    return <>{null}</>;
  };
}

// useLogger
describe("useLogger", () => {
  // Provider 配下では値を取得できること
  it("Provider 配下で渡された logger を返す", async () => {
    // テスト用 logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // Probe を作る
    const Probe = makeProbe(ref, () => useLogger());
    // Provider で囲んで描画
    await act(async () => {
      // Provider 内で hook 実行
      create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // Provider が渡した参照と同一であること
    expect(ref.current).toBe(logger);
  });

  // Provider 外では Error を投げること
  it("Provider 外で呼ばれた場合は Error を投げる", () => {
    // Probe 内部で発生した例外を補足する変数
    let captured: unknown;
    // Probe コンポーネント（Provider 外で hook を呼ぶ）
    function Probe(): React.JSX.Element {
      // React 19 では render 内 throw が同期的に伝搬しないため try/catch で補足
      try {
        // Provider 外なので throw される想定
        useLogger();
      } catch (error) {
        // 例外を退避
        captured = error;
      }
      // 描画は空
      return <>{null}</>;
    }
    // Provider なしで描画
    act(() => {
      // create を実行
      create(<Probe />);
    });
    // Error インスタンスであること
    expect(captured).toBeInstanceOf(Error);
    // メッセージに LoggerProvider への誘導が含まれること
    expect((captured as Error).message).toMatch(/useLogger must be called inside <LoggerProvider>/);
  });
});

// useScopedLogger
describe("useScopedLogger", () => {
  // 文字列引数のときは tags 1 件として child を呼ぶこと
  it("文字列引数を tags 1 件として child を呼ぶ", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 文字列引数で scoped logger を取得する Probe
    const Probe = makeProbe(ref, () => useScopedLogger("payment"));
    // Provider で囲んで描画
    await act(async () => {
      // 1 回描画
      create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // child が 1 回呼ばれていること
    expect(logger.child).toHaveBeenCalledTimes(1);
    // tags が ["payment"] で呼ばれていること
    expect(logger.child).toHaveBeenCalledWith({ tags: ["payment"] });
    // 戻り値が child の生成物であること
    expect(ref.current).toBeDefined();
    // 親と異なる identity を持つこと
    expect(ref.current).not.toBe(logger);
  });

  // オブジェクト引数（bindings）をそのまま渡せること
  it("オブジェクト引数を bindings としてそのまま child へ渡す", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 任意の bindings
    const bindings: LoggerBindings = { tags: ["api"], context: { userId: "u1" } };
    // bindings で scoped logger を取得する Probe
    const Probe = makeProbe(ref, () => useScopedLogger(bindings));
    // 描画
    await act(async () => {
      // 1 回描画
      create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // child が指定どおりに呼ばれていること
    expect(logger.child).toHaveBeenCalledWith(bindings);
  });

  // 同一 bindings での再 render では child を再生成しない（memoize される）
  it("同じ bindings で再 render すると child は再生成されない", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // Probe は文字列指定（毎回 { tags: ["x"] } を生成するが内容は同じ）
    const Probe = makeProbe(ref, () => useScopedLogger("x"));
    // create したインスタンスを保持
    let renderer: ReturnType<typeof create> | undefined;
    // 初回描画
    await act(async () => {
      // Provider 配下で Probe を 1 回描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 初回 child 呼び出し回数を退避
    const initialChildCalls = (logger.child as ReturnType<typeof vi.fn>).mock.calls.length;
    // 同一識別 child の参照を退避
    const firstChild = ref.current;
    // 同じ要素ツリーで強制再 render
    await act(async () => {
      // update で再 render を発火
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // child の呼び出し回数が増えていない（memoize が効いている）
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(initialChildCalls);
    // 同一 child 参照が返されていること
    expect(ref.current).toBe(firstChild);
  });

  // tags が変化したら child を再生成する
  it("tags が変化したら child を再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 切替可能な tag を外部 state で保持する Probe
    let currentTag = "alpha";
    // useScopedLogger は currentTag を参照する
    const Probe = makeProbe(ref, () => useScopedLogger(currentTag));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 1 回目 child 呼び出し回数
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    // tag を変更
    currentTag = "beta";
    // 再描画
    await act(async () => {
      // 同じツリーを update（Probe 内で hook が再評価される）
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 再生成されて 2 回呼ばれていること
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // context が変化したら child を再生成する
  it("context が変化したら child を再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 切替可能な bindings
    let bindings: LoggerBindings = { context: { reqId: "r1" } };
    // Probe
    const Probe = makeProbe(ref, () => useScopedLogger(bindings));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 1 回目 child 呼び出し回数
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    // context のキー値を変更
    bindings = { context: { reqId: "r2" } };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // child が再生成され 2 回呼ばれていること
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // context キー数だけ変化したケースも再生成する（キー集合変化分岐）
  it("context のキー数が変わると child を再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 初期はキー 1 件
    let bindings: LoggerBindings = { context: { a: 1 } };
    // Probe
    const Probe = makeProbe(ref, () => useScopedLogger(bindings));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // キー数を 2 に増やす
    bindings = { context: { a: 1, b: 2 } };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 再生成されて 2 回呼ばれていること
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // 親 logger インスタンスが変わったら child を再生成する
  it("親 logger が変化したら child を再生成する", async () => {
    // 1 つ目の親 logger
    const loggerA = makeLogger("A");
    // 2 つ目の親 logger
    const loggerB = makeLogger("B");
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // Probe（固定文字列 scope）
    const Probe = makeProbe(ref, () => useScopedLogger("scope"));
    // 初回は A を渡す
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={loggerA}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // A.child の呼び出し回数
    expect((loggerA.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    // A の child を退避
    const firstChild = ref.current;
    // 親を B に差し替える
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={loggerB}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // B.child が呼ばれること
    expect((loggerB.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    // child の参照が更新されていること
    expect(ref.current).not.toBe(firstChild);
  });

  // tags / context が両方 undefined の同一性チェックも通すこと（return true 分岐）
  it("tags / context がどちらも undefined のときも memoize する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 空 bindings を毎回新インスタンスで渡す
    const Probe = makeProbe(ref, () => useScopedLogger({}));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // child は 1 回しか呼ばれない（tags/context 両方 undefined の参照不一致を無視）
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // tags の長さは同じだが要素が異なるケース（要素差分の分岐網羅）
  it("tags の長さが同じでも要素が違えば再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 切替可能 tags
    let bindings: LoggerBindings = { tags: ["a", "b"] };
    // Probe
    const Probe = makeProbe(ref, () => useScopedLogger(bindings));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 要素の片方を変える（長さは維持）
    bindings = { tags: ["a", "c"] };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // child は 2 回呼ばれる
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // tags が片方 undefined ⇔ 配列 のときも再生成する（undefined 分岐）
  it("tags が undefined と配列の切替で再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 初期は tags 未指定
    let bindings: LoggerBindings = {};
    // Probe
    const Probe = makeProbe(ref, () => useScopedLogger(bindings));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // tags 配列を渡す
    bindings = { tags: ["x"] };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // child は 2 回呼ばれる
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // tags の長さが違うときも再生成する（長さ差分の分岐）
  it("tags の長さが違えば再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 初期は tags 1 件
    let bindings: LoggerBindings = { tags: ["a"] };
    // Probe
    const Probe = makeProbe(ref, () => useScopedLogger(bindings));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // tags を 2 件に増やす
    bindings = { tags: ["a", "b"] };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 再生成され child は 2 回呼ばれる
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // context が一方 undefined ⇔ オブジェクトのケース
  it("context が undefined とオブジェクトの切替で再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 初期は context 未指定
    let bindings: LoggerBindings = {};
    // Probe
    const Probe = makeProbe(ref, () => useScopedLogger(bindings));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // context を持つ bindings に切替
    bindings = { context: { k: 1 } };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 再生成され child は 2 回呼ばれる
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // context の参照は別だが内容が完全一致するときは memoize する（contextEqual の完全一致経路を網羅）
  it("context の内容が同じなら参照が違っても memoize する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 同じ内容を毎回新オブジェクトで作る Probe
    const Probe = makeProbe(ref, () => useScopedLogger({ context: { reqId: "same" } }));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 再描画（毎回 bindings オブジェクトは新規生成されるが context の内容は同じ）
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // child は 1 回しか呼ばれない（contextEqual が内容一致を検出）
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // StrictMode 下で 2 回 render されても、child は 1 回しか呼ばれない（useRef ベースの memoize が機能している）
  // (StrictMode は同一 commit 内で 2 回コンポーネント関数を呼ぶため、render 中の useRef mutation が壊れる典型ケース)
  it("StrictMode 配下でも child は 1 回だけ呼ばれる", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 文字列 scope の Probe
    const Probe = makeProbe(ref, () => useScopedLogger("strict"));
    // 描画（StrictMode で囲む）
    await act(async () => {
      // 標準的な StrictMode 構造で hook を 2 回呼ばせる
      create(
        <React.StrictMode>
          <LoggerProvider logger={logger}>
            <Probe />
          </LoggerProvider>
        </React.StrictMode>,
      );
    });
    // StrictMode で 2 回 render されても child は 1 回しか呼ばれていない（memoize が効いている）
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // context のキー名が違うケース（キー集合不一致分岐）
  it("context のキー名が変わると再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 初期キー
    let bindings: LoggerBindings = { context: { a: 1 } };
    // Probe
    const Probe = makeProbe(ref, () => useScopedLogger(bindings));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // キー名を別に変える（キー数は同じ）
    bindings = { context: { b: 1 } };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 再生成され child は 2 回呼ばれる
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
