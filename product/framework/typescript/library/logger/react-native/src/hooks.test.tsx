// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// React を取り込み
import * as React from "react";
// react-test-renderer から act / create を取り込み
import { act, create } from "react-test-renderer";
// core から Logger 型と LoggerBindings 型を取り込み
import type { Logger, LoggerBindings } from "@k1s0-ts-logger/core";

// Provider 経路で react-native のモジュール解決が発生する可能性に備えてモック
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

// テスト対象 hooks を取り込み
import { useLogger, useScopedLogger } from "./hooks.js";
// Provider を取り込み
import { LoggerProvider } from "./LoggerProvider.js";

// Logger モック factory
function makeLogger(label = "root"): Logger {
  // 最小限の Logger を返す
  const logger = {
    // 各レベル
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    // child は再帰的に新しい mock logger を返す
    child: vi.fn((bindings: LoggerBindings) => {
      // bindings の一部を label に含めて identity 判定できるようにする
      const childLabel = `${label}>child(${bindings.tags?.join(",") ?? ""}|${
        Object.keys(bindings.context ?? {}).length
      })`;
      // 再帰生成
      return makeLogger(childLabel);
    }) as unknown as Logger["child"],
    // flush / dispose は no-op
    flush: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    // 識別用
    __label: label,
  };
  // Logger 型へキャスト
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
describe("useLogger (react-native)", () => {
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
    // 例外を補足する変数
    let captured: unknown;
    // Provider なしで hook を呼ぶ関数コンポーネント
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
    // 描画
    act(() => {
      // Provider なし
      create(<Probe />);
    });
    // Error インスタンスであること
    expect(captured).toBeInstanceOf(Error);
    // メッセージに LoggerProvider への誘導が含まれること
    expect((captured as Error).message).toMatch(/useLogger must be called inside <LoggerProvider>/);
  });
});

// useScopedLogger（react 版と同じ実装のため代表ケースで網羅）
describe("useScopedLogger (react-native)", () => {
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
    // tags が ["payment"] で呼ばれていること
    expect(logger.child).toHaveBeenCalledWith({ tags: ["payment"] });
    // child の戻り値が返ること
    expect(ref.current).toBeDefined();
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

  // 同一 bindings での再 render では child を再生成しない
  it("同じ bindings で再 render すると child は再生成されない", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // Probe は文字列指定
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
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // child の呼び出し回数が増えていない
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(initialChildCalls);
    // 同一 child 参照が返されていること
    expect(ref.current).toBe(firstChild);
  });

  // tags が変化したら child を再生成する
  it("tags が変化したら child を再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 切替可能な tag
    let currentTag = "alpha";
    // Probe
    const ref: { current: Logger | undefined } = { current: undefined };
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
    // tag を変更
    currentTag = "beta";
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

  // tags の要素差分（同長）で再生成
  it("tags の要素差分（同長）で再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 切替可能 bindings
    let bindings: LoggerBindings = { tags: ["a", "b"] };
    // Probe
    const ref: { current: Logger | undefined } = { current: undefined };
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
    // 要素片方を変える（長さは維持）
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
    // 再生成され 2 回呼ばれる
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // tags 長さ差分で再生成
  it("tags の長さ差分で再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 初期は 1 件
    let bindings: LoggerBindings = { tags: ["a"] };
    // Probe
    const ref: { current: Logger | undefined } = { current: undefined };
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
    // 再生成される
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // tags が片方 undefined ⇔ 配列の切替で再生成
  it("tags が undefined⇔配列で再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 初期は tags 未指定
    let bindings: LoggerBindings = {};
    // Probe
    const ref: { current: Logger | undefined } = { current: undefined };
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
    // tags を渡す
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
    // 再生成される
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // context の参照は別でも内容が同じなら memoize する
  it("context の内容が同じなら参照が違っても memoize する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 戻り値の入れ物
    const ref: { current: Logger | undefined } = { current: undefined };
    // 毎回新オブジェクトだが内容同一
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
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // child は 1 回だけ呼ばれる
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // 同一キーで値だけ変わるケース（contextEqual の Object.is 不一致分岐）
  it("context の同一キーで値が変わると再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 初期値
    let bindings: LoggerBindings = { context: { reqId: "r1" } };
    // Probe
    const ref: { current: Logger | undefined } = { current: undefined };
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
    // 値だけ変える（キーは同じ）
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
    // 再生成され child は 2 回呼ばれる
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // context のキー名違いで再生成
  it("context のキー名が変わると再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 初期は a:1
    let bindings: LoggerBindings = { context: { a: 1 } };
    // Probe
    const ref: { current: Logger | undefined } = { current: undefined };
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
    // キー名を b:1 へ
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
    // 再生成される
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // context のキー数違いで再生成
  it("context のキー数が変わると再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 初期は 1 キー
    let bindings: LoggerBindings = { context: { a: 1 } };
    // Probe
    const ref: { current: Logger | undefined } = { current: undefined };
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
    // キーを増やす
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
    // 再生成される
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // context が undefined ⇔ オブジェクトで再生成
  it("context が undefined⇔オブジェクトで再生成する", async () => {
    // ベース logger
    const logger = makeLogger();
    // 初期は context 未指定
    let bindings: LoggerBindings = {};
    // Probe
    const ref: { current: Logger | undefined } = { current: undefined };
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
    // 再生成される
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // 親 logger 変化で再生成
  it("親 logger が変化したら child を再生成する", async () => {
    // 2 つの親 logger
    const loggerA = makeLogger("A");
    const loggerB = makeLogger("B");
    // Probe
    const ref: { current: Logger | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedLogger("scope"));
    // 初回 A
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <LoggerProvider logger={loggerA}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // 親を B に差し替え
    await act(async () => {
      // update
      renderer?.update(
        <LoggerProvider logger={loggerB}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // A と B でそれぞれ child が 1 回ずつ呼ばれている
    expect((loggerA.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((loggerB.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
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
      // StrictMode 配下で hook を 2 回呼ばせる
      create(
        <React.StrictMode>
          <LoggerProvider logger={logger}>
            <Probe />
          </LoggerProvider>
        </React.StrictMode>,
      );
    });
    // StrictMode で 2 回 render されても child は 1 回しか呼ばれていない
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // 両方 undefined の memoize
  it("tags / context 両方 undefined のときも memoize する", async () => {
    // ベース logger
    const logger = makeLogger();
    // Probe
    const ref: { current: Logger | undefined } = { current: undefined };
    // 空 bindings を毎回新規生成
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
    // child は 1 回しか呼ばれない
    expect((logger.child as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
