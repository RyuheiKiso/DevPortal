import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotificationManager } from "@k1s0-ts-notification/core";
import { installGlobalErrorNotifier } from "./globalErrorNotifier.js";

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
    errorUtils.getGlobalHandler()({ message: "down", status: 503 }, true);

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
      fake.utils.getGlobalHandler()({ message: "x", status: 500 }, false),
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

    fake.utils.getGlobalHandler()({ message: "x", code: "NETWORK" }, true);

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
});
