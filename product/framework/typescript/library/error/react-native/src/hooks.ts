import { useCallback, useContext } from "react";
import type { AppError } from "@k1s0-ts-error/core";
import { ErrorContext, type ErrorContextValue, type HandleErrorOptions } from "./context.js";

function ensureContext(value: ErrorContextValue | null): ErrorContextValue {
  if (value === null) {
    throw new Error("useErrorHandler must be called inside <ErrorProvider>");
  }
  return value;
}

export function useErrorContext(): ErrorContextValue {
  return ensureContext(useContext(ErrorContext));
}

export function useErrorHandler(): Pick<ErrorContextValue, "handleError" | "clearError" | "lastError"> {
  const { handleError, clearError, lastError } = useErrorContext();
  return { handleError, clearError, lastError };
}

export function useLastError(): AppError | null {
  return useErrorContext().lastError;
}

export function useAsyncErrorHandler<TArgs extends readonly unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options?: HandleErrorOptions,
): (...args: TArgs) => Promise<TResult | undefined> {
  const { handleError } = useErrorContext();
  return useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      try {
        return await fn(...args);
      } catch (caught) {
        handleError(caught, options);
        return undefined;
      }
    },
    [fn, handleError, options],
  );
}
