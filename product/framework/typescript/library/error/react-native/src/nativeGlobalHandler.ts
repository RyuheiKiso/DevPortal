import { normalizeError, type AppError, type NormalizeOptions } from "@k1s0-ts-error/core";

export interface NativeErrorUtilsLike {
  getGlobalHandler?(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

export interface RegisterNativeGlobalErrorHandlerOptions {
  errorUtils?: NativeErrorUtilsLike;
  normalizeOptions?: NormalizeOptions;
  onError(error: AppError, isFatal: boolean): void;
  callPrevious?: boolean;
}

function resolveErrorUtils(errorUtils?: NativeErrorUtilsLike): NativeErrorUtilsLike | undefined {
  if (errorUtils !== undefined) {
    return errorUtils;
  }
  return (globalThis as { ErrorUtils?: NativeErrorUtilsLike }).ErrorUtils;
}

export function registerNativeGlobalErrorHandler(
  options: RegisterNativeGlobalErrorHandlerOptions,
): () => void {
  const errorUtils = resolveErrorUtils(options.errorUtils);
  if (errorUtils === undefined) {
    throw new Error("React Native ErrorUtils is not available");
  }

  const previous = errorUtils.getGlobalHandler?.();
  const handler = (caught: unknown, isFatal = false): void => {
    const error = normalizeError(caught, {
      component: "ReactNativeGlobalErrorHandler",
      ...options.normalizeOptions,
    });
    options.onError(error, isFatal);
    if (options.callPrevious === true) {
      previous?.(caught, isFatal);
    }
  };

  errorUtils.setGlobalHandler(handler);

  return () => {
    if (previous !== undefined) {
      errorUtils.setGlobalHandler(previous);
    }
  };
}
