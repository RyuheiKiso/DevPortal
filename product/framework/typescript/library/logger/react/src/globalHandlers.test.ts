// vitest DSL を取り込み
import { afterEach, describe, expect, it, vi } from "vitest";
// core から Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";
// テスト対象を取り込み
import { installGlobalHandlers } from "./globalHandlers.js";

// テスト用 Logger モック factory
function makeLogger(): Logger {
  // 最小実装
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
  } as Logger;
}

// グローバル stub の解除を毎テスト後に行う
afterEach(() => {
  // vi.stubGlobal で書き換えた値を元に戻す
  vi.unstubAllGlobals();
});

// installGlobalHandlers のテスト
describe("installGlobalHandlers", () => {
  // window が無い環境（SSR）では no-op を返すこと
  it("SSR 環境では no-op uninstall を返す", () => {
    // window を undefined に置き換え
    vi.stubGlobal("window", undefined);
    // logger
    const logger = makeLogger();
    // 関数を呼ぶ
    const uninstall = installGlobalHandlers(logger);
    // 戻り値が関数であること（呼んでもエラーにならない）
    expect(typeof uninstall).toBe("function");
    // 実際に呼んでも例外にならない
    expect(() => uninstall()).not.toThrow();
  });

  // error イベントで logger.error が呼ばれること
  it("error イベントで logger.error が呼ばれる", () => {
    // logger
    const logger = makeLogger();
    // ハンドラを登録
    const uninstall = installGlobalHandlers(logger);
    // ErrorEvent を発火
    const errorObj = new Error("E1");
    // window へ dispatch
    window.dispatchEvent(
      // ErrorEvent コンストラクタを使う（jsdom 対応）
      new ErrorEvent("error", {
        // 例外本体
        error: errorObj,
        // メッセージ
        message: "E1",
        // 発生位置の擬似情報
        filename: "f.js",
        // 行番号
        lineno: 10,
        // 列番号
        colno: 5,
      }),
    );
    // logger.error が呼ばれていること
    expect(logger.error).toHaveBeenCalledWith("window.onerror", {
      // error フィールド
      error: errorObj,
      // 付属情報
      filename: "f.js",
      // 行
      lineno: 10,
      // 列
      colno: 5,
    });
    // 後片付け
    uninstall();
  });

  // error イベントで event.error が無い場合は message を error として渡すこと
  it("event.error が無い場合は message を error として渡す", () => {
    // logger
    const logger = makeLogger();
    // ハンドラを登録
    const uninstall = installGlobalHandlers(logger);
    // ErrorEvent を error 無しで発火
    window.dispatchEvent(
      // ErrorEvent
      new ErrorEvent("error", {
        // error 未指定
        message: "msg-only",
        // 位置情報
        filename: "g.js",
        lineno: 1,
        colno: 1,
      }),
    );
    // logger.error の引数を取得（noUncheckedIndexedAccess 対応）
    const callArg = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      error: unknown;
    };
    // error フィールドが message 文字列になっていること
    expect(callArg.error).toBe("msg-only");
    // 後片付け
    uninstall();
  });

  // jsdom 上で PromiseRejectionEvent コンストラクタが未提供のため、Event を生成して reason を後付け
  function dispatchUnhandledRejection(reason: unknown): void {
    // 基本 Event を生成
    const event = new Event("unhandledrejection") as Event & {
      // PromiseRejectionEvent と同じ shape を満たす
      promise: Promise<unknown>;
      reason: unknown;
    };
    // promise を捏造して付与（jsdom がデフォルトの unhandledrejection を出すのを防ぐためすぐに catch）
    const fakePromise = Promise.reject(reason);
    // 警告抑制のため catch
    fakePromise.catch(() => {});
    // event に必要プロパティを後付け
    event.promise = fakePromise;
    // reason を付与
    event.reason = reason;
    // window へ dispatch
    window.dispatchEvent(event);
  }

  // unhandledrejection で logger.error が呼ばれること（既定）
  it("unhandledrejection で logger.error が呼ばれる（既定）", () => {
    // logger
    const logger = makeLogger();
    // ハンドラを登録
    const uninstall = installGlobalHandlers(logger);
    // 擬似 unhandledrejection を発火
    dispatchUnhandledRejection(new Error("R1"));
    // logger.error が呼ばれていること
    expect(logger.error).toHaveBeenCalledWith(
      // 第 1 引数（タイトル）
      "window.unhandledrejection",
      // 第 2 引数の構造
      expect.objectContaining({ error: expect.any(Error) }),
    );
    // 後片付け
    uninstall();
  });

  // fatalForUnhandled: true のとき unhandledrejection は logger.fatal を呼ぶこと
  it("fatalForUnhandled: true で logger.fatal が呼ばれる", () => {
    // logger
    const logger = makeLogger();
    // ハンドラを登録（fatal 切替）
    const uninstall = installGlobalHandlers(logger, { fatalForUnhandled: true });
    // 擬似 unhandledrejection を発火
    dispatchUnhandledRejection(new Error("F1"));
    // logger.fatal が呼ばれていること
    expect(logger.fatal).toHaveBeenCalled();
    // logger.error は呼ばれていないこと（同イベントでは fatal 一択）
    expect(logger.error).not.toHaveBeenCalled();
    // 後片付け
    uninstall();
  });

  // uninstall 後はイベントを発火しても logger が呼ばれないこと
  it("uninstall するとイベントを受け取らない", () => {
    // logger
    const logger = makeLogger();
    // ハンドラを登録
    const uninstall = installGlobalHandlers(logger);
    // すぐに uninstall
    uninstall();
    // error イベントを発火
    window.dispatchEvent(
      // ErrorEvent
      new ErrorEvent("error", { error: new Error("X"), message: "X", filename: "x", lineno: 1, colno: 1 }),
    );
    // logger.error は呼ばれていないこと
    expect(logger.error).not.toHaveBeenCalled();
  });

  // uninstall を 2 回呼んでも安全（冪等性）
  it("uninstall は冪等で 2 回呼んでも安全", () => {
    // logger
    const logger = makeLogger();
    // 登録
    const uninstall = installGlobalHandlers(logger);
    // 1 回目
    uninstall();
    // 2 回目は何もしない
    expect(() => uninstall()).not.toThrow();
  });

  // 同じ logger で再 install すると、前回の listener は解除されて二重呼び出しが起きないこと
  it("同じ logger に再 install すると前回の listener は解除される", () => {
    // logger
    const logger = makeLogger();
    // 1 回目登録（解除関数は捨てる）
    installGlobalHandlers(logger);
    // 2 回目登録（前回の登録を内部で解除する想定）
    const uninstall2 = installGlobalHandlers(logger);
    // error イベントを発火
    window.dispatchEvent(
      // ErrorEvent
      new ErrorEvent("error", { error: new Error("Y"), message: "Y", filename: "y", lineno: 1, colno: 1 }),
    );
    // logger.error は 1 回しか呼ばれていないこと（二重登録されていない）
    expect(logger.error).toHaveBeenCalledTimes(1);
    // 後片付け
    uninstall2();
  });
});
