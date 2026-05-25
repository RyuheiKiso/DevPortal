// vitest DSL を取り込み
import { afterEach, describe, expect, it, vi } from "vitest";
// core から Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";
// テスト対象を取り込み
import { installGlobalErrorHandler } from "./errorUtils.js";

// React Native の ErrorUtils シグネチャ（テスト用）
interface RNErrorUtils {
  // 既存ハンドラ取得
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  // ハンドラ設定
  setGlobalHandler(fn: (error: unknown, isFatal?: boolean) => void): void;
}

// Logger モック factory
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
    // child は self
    child: vi.fn().mockReturnThis(),
    // flush / dispose
    flush: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  } as Logger;
}

// 各テスト後に globalThis.ErrorUtils を消去
afterEach(() => {
  // 直接削除（vi.stubGlobal だと TS の型で扱いにくいため）
  delete (globalThis as unknown as { ErrorUtils?: RNErrorUtils }).ErrorUtils;
});

// ErrorUtils スタブを globalThis に注入する小ヘルパ
function installFakeErrorUtils(): {
  errorUtils: RNErrorUtils;
  previous: (error: unknown, isFatal?: boolean) => void;
  current: { handler: (error: unknown, isFatal?: boolean) => void };
} {
  // 直前のハンドラ（ErrorUtils が install 前に保持しているもの）
  const previous = vi.fn();
  // 現在の handler を保持する箱
  const current = { handler: previous as (error: unknown, isFatal?: boolean) => void };
  // モック実装
  const errorUtils: RNErrorUtils = {
    // 現在の handler を返す
    getGlobalHandler: () => current.handler,
    // handler を差し替え
    setGlobalHandler: (fn) => {
      // current.handler を上書き
      current.handler = fn;
    },
  };
  // global へ注入
  (globalThis as unknown as { ErrorUtils: RNErrorUtils }).ErrorUtils = errorUtils;
  // テストから使うのを返す
  return { errorUtils, previous, current };
}

// installGlobalErrorHandler のテスト
describe("installGlobalErrorHandler", () => {
  // ErrorUtils が存在しない環境では no-op を返すこと
  it("ErrorUtils 未定義環境では no-op uninstall を返す", () => {
    // ErrorUtils をセットしない
    const logger = makeLogger();
    // install
    const uninstall = installGlobalErrorHandler(logger);
    // 戻り値が関数
    expect(typeof uninstall).toBe("function");
    // 呼んでも例外を投げない
    expect(() => uninstall()).not.toThrow();
  });

  // install すると新ハンドラが setGlobalHandler 経由でセットされること
  it("install すると新ハンドラが set される", () => {
    // ErrorUtils 注入
    const { current, previous } = installFakeErrorUtils();
    // logger
    const logger = makeLogger();
    // install
    installGlobalErrorHandler(logger);
    // current.handler が previous と違うものになっていること
    expect(current.handler).not.toBe(previous);
  });

  // isFatal=true のとき logger.fatal が呼ばれること
  it("isFatal=true のとき logger.fatal が呼ばれる", () => {
    // ErrorUtils 注入
    const { current } = installFakeErrorUtils();
    // logger
    const logger = makeLogger();
    // install
    installGlobalErrorHandler(logger);
    // 新ハンドラを呼ぶ
    const err = new Error("fatal-err");
    current.handler(err, true);
    // logger.fatal が呼ばれていること
    expect(logger.fatal).toHaveBeenCalledWith("react-native.globalError", {
      // error
      error: err,
      // isFatal
      isFatal: true,
    });
  });

  // isFatal=false のとき logger.error が呼ばれること（既定 nonFatalLevel: "error"）
  it("isFatal=false のとき logger.error が呼ばれる（既定）", () => {
    // ErrorUtils 注入
    const { current } = installFakeErrorUtils();
    // logger
    const logger = makeLogger();
    // install
    installGlobalErrorHandler(logger);
    // 新ハンドラを呼ぶ
    const err = new Error("non-fatal-err");
    current.handler(err, false);
    // logger.error が呼ばれていること
    expect(logger.error).toHaveBeenCalledWith("react-native.globalError", {
      // error
      error: err,
      // isFatal
      isFatal: false,
    });
  });

  // fatalLevel を error に変えると isFatal=true でも logger.error が呼ばれること
  it("fatalLevel: 'error' で isFatal=true でも logger.error が呼ばれる", () => {
    // ErrorUtils 注入
    const { current } = installFakeErrorUtils();
    // logger
    const logger = makeLogger();
    // install with override
    installGlobalErrorHandler(logger, { fatalLevel: "error" });
    // 新ハンドラを呼ぶ
    current.handler(new Error("e"), true);
    // logger.error が呼ばれること
    expect(logger.error).toHaveBeenCalled();
    // logger.fatal は呼ばれないこと
    expect(logger.fatal).not.toHaveBeenCalled();
  });

  // nonFatalLevel を warn に変えると isFatal=false で logger.warn が呼ばれること
  it("nonFatalLevel: 'warn' で isFatal=false のとき logger.warn が呼ばれる", () => {
    // ErrorUtils 注入
    const { current } = installFakeErrorUtils();
    // logger
    const logger = makeLogger();
    // install with override
    installGlobalErrorHandler(logger, { nonFatalLevel: "warn" });
    // 新ハンドラを呼ぶ
    current.handler(new Error("w"), false);
    // logger.warn が呼ばれること
    expect(logger.warn).toHaveBeenCalled();
    // logger.error は呼ばれないこと
    expect(logger.error).not.toHaveBeenCalled();
  });

  // callPreviousHandler: true（既定）で previous が呼ばれること
  it("callPreviousHandler: true（既定）で previous が呼ばれる", () => {
    // ErrorUtils 注入（previous をモック）
    const { current, previous } = installFakeErrorUtils();
    // logger
    const logger = makeLogger();
    // install（既定）
    installGlobalErrorHandler(logger);
    // 新ハンドラを呼ぶ
    const err = new Error("prev");
    current.handler(err, true);
    // previous が呼ばれていること
    expect(previous).toHaveBeenCalledWith(err, true);
  });

  // callPreviousHandler: false で previous が呼ばれないこと
  it("callPreviousHandler: false で previous は呼ばれない", () => {
    // ErrorUtils 注入
    const { current, previous } = installFakeErrorUtils();
    // logger
    const logger = makeLogger();
    // install with override
    installGlobalErrorHandler(logger, { callPreviousHandler: false });
    // 新ハンドラを呼ぶ
    current.handler(new Error("np"), false);
    // previous は呼ばれていないこと
    expect(previous).not.toHaveBeenCalled();
  });

  // uninstall で previous に戻ること
  it("uninstall すると previous に戻る", () => {
    // ErrorUtils 注入
    const { current, previous } = installFakeErrorUtils();
    // logger
    const logger = makeLogger();
    // install → uninstall
    const uninstall = installGlobalErrorHandler(logger);
    uninstall();
    // 現在のハンドラが previous であること
    expect(current.handler).toBe(previous);
  });

  // uninstall は冪等
  it("uninstall は冪等で 2 回呼んでも安全", () => {
    // ErrorUtils 注入
    installFakeErrorUtils();
    // logger
    const logger = makeLogger();
    // install
    const uninstall = installGlobalErrorHandler(logger);
    // 1 回目
    uninstall();
    // 2 回目は何もしない
    expect(() => uninstall()).not.toThrow();
  });

  // uninstall 時に他者が上書きしていた場合は触らない
  it("uninstall 時に他者がハンドラを上書きしていれば触らない", () => {
    // ErrorUtils 注入
    const { current } = installFakeErrorUtils();
    // logger
    const logger = makeLogger();
    // install
    const uninstall = installGlobalErrorHandler(logger);
    // 自分の handler を退避
    const ours = current.handler;
    // 他者が上書きする
    const foreign = vi.fn();
    current.handler = foreign;
    // uninstall
    uninstall();
    // current.handler は foreign のまま（previous に戻されない）
    expect(current.handler).toBe(foreign);
    // 念のため、自分の handler は変わっていないこと
    expect(ours).not.toBe(foreign);
  });
});
