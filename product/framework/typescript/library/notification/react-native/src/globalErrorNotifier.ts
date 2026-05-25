import {
  fromHttpError,
  isHttpErrorLike,
  type NotificationManager,
  type ToastInput,
} from "@k1s0-ts-notification/core";

interface RNErrorUtils {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(fn: (error: unknown, isFatal?: boolean) => void): void;
}

type GlobalWithErrorUtils = typeof globalThis & { ErrorUtils?: RNErrorUtils };

export interface GlobalErrorNotifierOptions {
  fatalLevel?: "error" | "warning";
  nonFatalLevel?: "error" | "warning" | "info";
  callPreviousHandler?: boolean;
  dedupeKey?: (error: unknown, isFatal: boolean) => string | undefined;
  buildToast?: (error: unknown, isFatal: boolean) => ToastInput;
}

export function installGlobalErrorNotifier(
  manager: NotificationManager,
  options: GlobalErrorNotifierOptions = {},
): () => void {
  const target = globalThis as GlobalWithErrorUtils;
  const errorUtils = target.ErrorUtils;
  if (errorUtils === undefined) {
    return () => {};
  }

  const fatalLevel = options.fatalLevel ?? "error";
  const nonFatalLevel = options.nonFatalLevel ?? "error";
  const callPrevious = options.callPreviousHandler ?? true;
  const previous = errorUtils.getGlobalHandler();

  const toast = (input: ToastInput, dedupeKey: string | undefined): void => {
    try {
      manager.toast(input.dedupeKey === undefined && dedupeKey !== undefined ? { ...input, dedupeKey } : input);
    } catch {
      // Keep React Native's global handler path alive even if notification delivery fails.
    }
  };

  const handler = (error: unknown, isFatal?: boolean): void => {
    const fatal = isFatal === true;
    const dedupeKey = options.dedupeKey?.(error, fatal);

    if (options.buildToast !== undefined) {
      toast(options.buildToast(error, fatal), dedupeKey);
    } else if (isHttpErrorLike(error)) {
      toast(fromHttpError(error, { dedupeKey }), undefined);
    } else {
      const level = fatal ? fatalLevel : nonFatalLevel;
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : String(error);
      toast({ level, message }, dedupeKey);
    }

    if (callPrevious) {
      previous(error, isFatal);
    }
  };

  errorUtils.setGlobalHandler(handler);

  let removed = false;
  return () => {
    if (removed) {
      return;
    }
    removed = true;
    if (errorUtils.getGlobalHandler() === handler) {
      errorUtils.setGlobalHandler(previous);
    }
  };
}
