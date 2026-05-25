import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotificationManager } from "@k1s0-ts-notification/core";
import { installGlobalErrorNotifier, type Logger } from "./globalErrorNotifier.js";

interface FakeErrorUtils {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(fn: (error: unknown, isFatal?: boolean) => void): void;
}

let savedErrorUtils: unknown;

function installFakeErrorUtils(): { utils: FakeErrorUtils; previous: () => (error: unknown, isFatal?: boolean) => void } {
  let currentHandler: (error: unknown, isFatal?: boolean) => void = () => {};
  const utils: FakeErrorUtils = {
    getGlobalHandler: () => currentHandler,
    setGlobalHandler: (fn) => {
      currentHandler = fn;
    },
  };
  savedErrorUtils = (globalThis as { ErrorUtils?: FakeErrorUtils }).ErrorUtils;
  Object.defineProperty(globalThis, "ErrorUtils", {
    value: utils,
    configurable: true,
    writable: true,
  });
  return {
    utils,
    previous: () => currentHandler,
  };
}

describe("installGlobalErrorNotifier", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "ErrorUtils", {
      value: savedErrorUtils,
      configurable: true,
      writable: true,
    });
    savedErrorUtils = undefined;
  });

  it("returns a no-op uninstall function when ErrorUtils is unavailable", () => {
    Object.defineProperty(globalThis, "ErrorUtils", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    const uninstall = installGlobalErrorNotifier(manager);

    expect(typeof uninstall).toBe("function");
    expect(toastSpy).not.toHaveBeenCalled();
    uninstall();
  });

  it("turns normal Error objects into toast notifications", () => {
    installFakeErrorUtils();
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    installGlobalErrorNotifier(manager);

    const errorUtils = (globalThis as { ErrorUtils?: FakeErrorUtils }).ErrorUtils!;
    errorUtils.getGlobalHandler()(new Error("boom"), false);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]?.[0].message).toBe("boom");
  });

  it("maps HttpErrorLike values through fromHttpError", () => {
    installFakeErrorUtils();
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    installGlobalErrorNotifier(manager);

    const errorUtils = (globalThis as { ErrorUtils?: FakeErrorUtils }).ErrorUtils!;
    // retryable は HttpError 正典の brand check として必須
    errorUtils.getGlobalHandler()({ message: "down", status: 503, retryable: false }, true);

    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]?.[0].level).toBe("error");
    expect(toastSpy.mock.calls[0]?.[0].title).toContain("サーバーエラー");
  });

  it("uses custom buildToast output", () => {
    installFakeErrorUtils();
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    installGlobalErrorNotifier(manager, {
      buildToast: (err, fatal) => ({
        level: fatal ? "error" : "warning",
        message: `custom:${(err as Error).message}`,
      }),
    });

    const errorUtils = (globalThis as { ErrorUtils?: FakeErrorUtils }).ErrorUtils!;
    errorUtils.getGlobalHandler()(new Error("x"), true);

    expect(toastSpy.mock.calls[0]?.[0].message).toBe("custom:x");
  });

  it("applies dedupeKey to buildToast output when buildToast does not set one", () => {
    installFakeErrorUtils();
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    installGlobalErrorNotifier(manager, {
      dedupeKey: () => "custom-key",
      buildToast: () => ({ level: "error", message: "custom" }),
    });

    const errorUtils = (globalThis as { ErrorUtils?: FakeErrorUtils }).ErrorUtils!;
    errorUtils.getGlobalHandler()(new Error("x"), true);

    expect(toastSpy.mock.calls[0]?.[0].dedupeKey).toBe("custom-key");
  });

  it("keeps buildToast dedupeKey when it explicitly sets one", () => {
    installFakeErrorUtils();
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    installGlobalErrorNotifier(manager, {
      dedupeKey: () => "outer-key",
      buildToast: () => ({ level: "error", message: "custom", dedupeKey: "inner-key" }),
    });

    const errorUtils = (globalThis as { ErrorUtils?: FakeErrorUtils }).ErrorUtils!;
    errorUtils.getGlobalHandler()(new Error("x"), true);

    expect(toastSpy.mock.calls[0]?.[0].dedupeKey).toBe("inner-key");
  });

  it("does not call the previous handler when disabled", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    installGlobalErrorNotifier(manager, { callPreviousHandler: false });

    fake.utils.getGlobalHandler()(new Error("x"), false);

    expect(previous).not.toHaveBeenCalled();
  });

  it("calls the previous handler by default", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    installGlobalErrorNotifier(manager);

    fake.utils.getGlobalHandler()(new Error("x"), false);

    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("restores the previous handler and is idempotent", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    const uninstall = installGlobalErrorNotifier(manager);

    expect(fake.utils.getGlobalHandler()).not.toBe(previous);
    uninstall();
    expect(fake.utils.getGlobalHandler()).toBe(previous);
    uninstall();
    expect(fake.utils.getGlobalHandler()).toBe(previous);
  });

  it("does not restore if another handler has replaced it", () => {
    const fake = installFakeErrorUtils();
    const manager = createNotificationManager();
    const uninstall = installGlobalErrorNotifier(manager);
    const otherHandler = vi.fn();
    fake.utils.setGlobalHandler(otherHandler);

    uninstall();

    expect(fake.utils.getGlobalHandler()).toBe(otherHandler);
  });

  it("swallows manager.toast failures for normal errors", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    vi.spyOn(manager, "toast").mockImplementation(() => {
      throw new Error("inner");
    });
    installGlobalErrorNotifier(manager);

    expect(() => fake.utils.getGlobalHandler()(new Error("x"), false)).not.toThrow();
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("converts string errors to message text", () => {
    const fake = installFakeErrorUtils();
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    installGlobalErrorNotifier(manager);

    fake.utils.getGlobalHandler()("plain string", false);

    expect(toastSpy.mock.calls[0]?.[0].message).toBe("plain string");
  });

  it("converts other unknown values with String", () => {
    const fake = installFakeErrorUtils();
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    installGlobalErrorNotifier(manager);

    fake.utils.getGlobalHandler()(null, false);

    expect(toastSpy.mock.calls[0]?.[0].message).toBe("null");
  });

  it("swallows manager.toast failures for HttpErrorLike values", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    vi.spyOn(manager, "toast").mockImplementation(() => {
      throw new Error("inner");
    });
    installGlobalErrorNotifier(manager);

    expect(() =>
      // retryable は HttpError 正典の brand check として必須
      fake.utils.getGlobalHandler()({ message: "x", status: 500, retryable: false }, false),
    ).not.toThrow();
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("swallows manager.toast failures for buildToast values", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    vi.spyOn(manager, "toast").mockImplementation(() => {
      throw new Error("inner");
    });
    installGlobalErrorNotifier(manager, {
      buildToast: () => ({ level: "error", message: "custom" }),
    });

    expect(() => fake.utils.getGlobalHandler()(new Error("x"), false)).not.toThrow();
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("passes dedupeKey through the HttpErrorLike path", () => {
    const fake = installFakeErrorUtils();
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    installGlobalErrorNotifier(manager, {
      dedupeKey: (err, fatal) => `${fatal ? "f" : "nf"}-${(err as { code?: string }).code ?? "x"}`,
    });

    // retryable は HttpError 正典の brand check として必須
    fake.utils.getGlobalHandler()({ message: "x", code: "NETWORK", retryable: false }, true);

    expect(toastSpy.mock.calls[0]?.[0].dedupeKey).toBe("f-NETWORK");
  });

  it("passes dedupeKey through the non-HttpErrorLike path", () => {
    const fake = installFakeErrorUtils();
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    installGlobalErrorNotifier(manager, {
      dedupeKey: (_err, fatal) => (fatal ? "fatal" : "non-fatal"),
    });

    fake.utils.getGlobalHandler()(new Error("x"), true);

    expect(toastSpy.mock.calls[0]?.[0].dedupeKey).toBe("fatal");
  });

  // logger 経路: ErrorUtils が無い環境では warn が 1 回呼ばれる
  it("logs a warning when ErrorUtils is unavailable", () => {
    Object.defineProperty(globalThis, "ErrorUtils", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const manager = createNotificationManager();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    installGlobalErrorNotifier(manager, { logger });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toBe("globalErrorNotifier.errorUtilsUnavailable");
    expect(logger.error).not.toHaveBeenCalled();
  });

  // logger 経路: HttpErrorLike 経路で manager.toast が throw した場合に error 経路へ流れる
  it("logs an error with cause when manager.toast throws for HttpErrorLike values", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    const cause = new Error("inner");
    vi.spyOn(manager, "toast").mockImplementation(() => {
      throw cause;
    });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    installGlobalErrorNotifier(manager, { logger });

    // retryable は HttpError 正典の brand check として必須
    fake.utils.getGlobalHandler()({ message: "x", status: 500, retryable: false }, false);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]?.[0]).toBe("globalErrorNotifier.toastFailed");
    expect(logger.error.mock.calls[0]?.[1]).toEqual({ cause });
    // 既定挙動: previous は依然として呼ばれる
    expect(previous).toHaveBeenCalledTimes(1);
  });

  // logger 経路: buildToast 経路で例外が出た場合も logger.error が呼ばれる
  it("logs an error with cause when manager.toast throws for buildToast values", () => {
    const fake = installFakeErrorUtils();
    const manager = createNotificationManager();
    const cause = new Error("inner");
    vi.spyOn(manager, "toast").mockImplementation(() => {
      throw cause;
    });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    installGlobalErrorNotifier(manager, {
      logger,
      buildToast: () => ({ level: "error", message: "custom" }),
    });

    fake.utils.getGlobalHandler()(new Error("x"), true);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]?.[0]).toBe("globalErrorNotifier.toastFailed");
    expect(logger.error.mock.calls[0]?.[1]).toEqual({ cause });
  });

  // 後方互換: logger 未指定時は ErrorUtils 不在でも完全 silent
  it("stays silent when ErrorUtils is unavailable and no logger is supplied", () => {
    Object.defineProperty(globalThis, "ErrorUtils", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const manager = createNotificationManager();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      installGlobalErrorNotifier(manager);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  // 既定: previous handler には元の isFatal を渡す（undefined を保つ）
  // これにより Sentry/Bugsnag 等の下流 handler が undefined と explicit false を区別できる契約を保つ
  it("passes original isFatal to the previous handler by default (undefined preserved)", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    installGlobalErrorNotifier(manager);

    // 呼出側が isFatal を渡さなければ、previous には undefined が渡る
    fake.utils.getGlobalHandler()(new Error("x"));

    expect(previous).toHaveBeenCalledTimes(1);
    expect(previous.mock.calls[0]?.[1]).toBeUndefined();
  });

  // 既定: previous handler には false も false として渡る（explicit false の保持）
  it("passes original false as false (not normalized) to the previous handler", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    installGlobalErrorNotifier(manager);

    fake.utils.getGlobalHandler()(new Error("x"), false);

    expect(previous.mock.calls[0]?.[1]).toBe(false);
  });

  // opt-in: normalizeFatalForPrevious=true で正規化済み boolean を渡す（undefined → false に丸める）
  it("passes normalized fatal boolean when normalizeFatalForPrevious=true", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    installGlobalErrorNotifier(manager, { normalizeFatalForPrevious: true });

    // isFatal を渡さなくても、previous には false（正規化済み）が渡る
    fake.utils.getGlobalHandler()(new Error("x"));

    expect(previous.mock.calls[0]?.[1]).toBe(false);
  });

  // dedupeKey resolver の throw は handler 全体を止めない（logger.error で記録）
  it("swallows dedupeKey resolver throw and logs error", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const cause = new Error("resolver-boom");
    installGlobalErrorNotifier(manager, {
      logger,
      dedupeKey: () => {
        throw cause;
      },
    });

    // dedupeKey 解決失敗でも handler は完走する
    expect(() => fake.utils.getGlobalHandler()(new Error("x"), false)).not.toThrow();
    // toast は dedupeKey 無しで呼ばれる
    expect(toastSpy).toHaveBeenCalledTimes(1);
    // previous も呼ばれる
    expect(previous).toHaveBeenCalledTimes(1);
    // logger.error は dedupeKeyResolverFailed として記録
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0]?.[0]).toBe("globalErrorNotifier.dedupeKeyResolverFailed");
    expect(logger.error.mock.calls[0]?.[1]).toEqual({ cause });
  });

  // buildToast の throw も handler 全体を止めない（logger.error 記録 + previous 呼出は維持）
  it("swallows buildToast throw and logs error and still calls previous", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const cause = new Error("build-boom");
    installGlobalErrorNotifier(manager, {
      logger,
      buildToast: () => {
        throw cause;
      },
    });

    expect(() => fake.utils.getGlobalHandler()(new Error("x"), false)).not.toThrow();
    expect(previous).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0]?.[0]).toBe("globalErrorNotifier.handlerFailed");
    expect(logger.error.mock.calls[0]?.[1]).toEqual({ cause });
  });

  // previous handler 自体の throw も握る（logger.error で記録、他経路は維持）
  it("swallows previous handler throw and logs error", () => {
    const fake = installFakeErrorUtils();
    const cause = new Error("prev-boom");
    fake.utils.setGlobalHandler(() => {
      throw cause;
    });
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    installGlobalErrorNotifier(manager, { logger });

    expect(() => fake.utils.getGlobalHandler()(new Error("x"), false)).not.toThrow();
    // toast は完走
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]?.[0]).toBe("globalErrorNotifier.previousHandlerFailed");
    expect(logger.error.mock.calls[0]?.[1]).toEqual({ cause });
  });

  // logger 自体の throw は完全に握る（global handler 経路の保護を最優先）
  it("swallows logger throws silently", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    vi.spyOn(manager, "toast").mockImplementation(() => {
      throw new Error("inner");
    });
    // 全メソッドが throw する壊れた logger
    const brokenLogger: Logger = {
      debug: () => {
        throw new Error("logger boom");
      },
      info: () => {
        throw new Error("logger boom");
      },
      warn: () => {
        throw new Error("logger boom");
      },
      error: () => {
        throw new Error("logger boom");
      },
    };

    installGlobalErrorNotifier(manager, { logger: brokenLogger });

    // logger.error が throw しても handler は完走、previous も呼ばれる
    expect(() => fake.utils.getGlobalHandler()(new Error("x"), false)).not.toThrow();
    expect(previous).toHaveBeenCalledTimes(1);
  });

  // String() / toString が throw する値でも handler は完走
  it("handles values whose toString throws and still calls previous", () => {
    const fake = installFakeErrorUtils();
    const previous = vi.fn();
    fake.utils.setGlobalHandler(previous);
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");
    installGlobalErrorNotifier(manager);

    // toString が throw する非 Error / 非 string 値
    const poisoned = {
      toString(): string {
        throw new Error("toString boom");
      },
    };

    expect(() => fake.utils.getGlobalHandler()(poisoned, false)).not.toThrow();
    // fallback message で toast 完走
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0]?.[0].message).toBe("[unconvertible error]");
    // previous も呼ばれる
    expect(previous).toHaveBeenCalledTimes(1);
  });

  // 同一 manager に対する二重 install は前の uninstall を自動呼出 + warn
  it("replaces previous install for the same manager and warns", () => {
    installFakeErrorUtils();
    const manager = createNotificationManager();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    // 1 回目 install
    installGlobalErrorNotifier(manager, { logger });
    // この時点では errorUtilsUnavailable などの warn は無い（ErrorUtils 存在）
    expect(logger.warn).not.toHaveBeenCalled();

    // 2 回目 install
    installGlobalErrorNotifier(manager, { logger });

    // replacingPreviousInstall の warn が記録される
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toBe("globalErrorNotifier.replacingPreviousInstall");
  });

  // 二重 install の結果、toast は 1 回しか発火しない（古い handler が前段で生きていない）
  it("does not double-fire toast after re-installing on the same manager", () => {
    const fake = installFakeErrorUtils();
    const manager = createNotificationManager();
    const toastSpy = vi.spyOn(manager, "toast");

    installGlobalErrorNotifier(manager);
    installGlobalErrorNotifier(manager);

    fake.utils.getGlobalHandler()(new Error("x"), false);

    // 重複 install による N 倍発火が起きない
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  // getGlobalHandler が install 時に throw しても install は完走（no-op fallback で previous を保持）
  it("logs and continues install when getGlobalHandler throws", () => {
    const cause = new Error("getter boom");
    Object.defineProperty(globalThis, "ErrorUtils", {
      value: {
        getGlobalHandler: () => {
          throw cause;
        },
        setGlobalHandler: () => {},
      },
      configurable: true,
      writable: true,
    });
    const manager = createNotificationManager();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const uninstall = installGlobalErrorNotifier(manager, { logger });

    expect(typeof uninstall).toBe("function");
    expect(logger.error.mock.calls[0]?.[0]).toBe("globalErrorNotifier.getPreviousHandlerFailed");
    expect(logger.error.mock.calls[0]?.[1]).toEqual({ cause });
  });

  // setGlobalHandler が install 時に throw した場合は no-op uninstall を返し、logger に記録
  it("returns no-op uninstall when setGlobalHandler throws at install time", () => {
    const cause = new Error("setter boom");
    let currentHandler: ((error: unknown, isFatal?: boolean) => void) | undefined;
    Object.defineProperty(globalThis, "ErrorUtils", {
      value: {
        getGlobalHandler: () => currentHandler ?? (() => {}),
        setGlobalHandler: () => {
          throw cause;
        },
      },
      configurable: true,
      writable: true,
    });
    const manager = createNotificationManager();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const uninstall = installGlobalErrorNotifier(manager, { logger });

    // logger.error には setGlobalHandlerFailed
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0]?.[0]).toBe("globalErrorNotifier.setGlobalHandlerFailed");
    expect(logger.error.mock.calls[0]?.[1]).toEqual({ cause });
    // uninstall は no-op 関数（呼んでも throw しない）
    expect(() => uninstall()).not.toThrow();
  });
});
