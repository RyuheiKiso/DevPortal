import type { ReactElement, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import {
  normalizeError,
  toLogRecord,
  toNotification,
  type AppError,
  type ErrorContext as CoreErrorContext,
} from "@k1s0-ts-error/core";
import { ErrorContext, type ErrorLogger, type ErrorNotification, type HandleErrorOptions } from "./context.js";

export interface ErrorProviderProps {
  children: ReactNode;
  logger?: ErrorLogger;
  notification?: ErrorNotification;
  onError?: (error: AppError) => void;
  onUnauthorized?: (error: AppError) => void;
  onForbidden?: (error: AppError) => void;
}

export function ErrorProvider(props: ErrorProviderProps): ReactElement {
  const { children, logger, notification, onError, onForbidden, onUnauthorized } = props;
  const [lastError, setLastError] = useState<AppError | null>(null);

  const clearError = useCallback(() => setLastError(null), []);
  const normalize = useCallback((error: unknown, context?: CoreErrorContext): AppError => normalizeError(error, context), []);

  const handleError = useCallback(
    (caught: unknown, options: HandleErrorOptions = {}): AppError => {
      const appError = normalizeError(caught, options);
      setLastError(appError);

      if (options.log !== false) {
        logger?.error(appError.message, toLogRecord(appError));
      }
      if (options.notify !== false) {
        notification?.show(toNotification(appError));
      }

      onError?.(appError);
      if (appError.kind === "auth") {
        onUnauthorized?.(appError);
      }
      if (appError.kind === "permission") {
        onForbidden?.(appError);
      }

      return appError;
    },
    [logger, notification, onError, onForbidden, onUnauthorized],
  );

  const value = useMemo(
    () => ({ lastError, handleError, clearError, normalize }),
    [clearError, handleError, lastError, normalize],
  );

  return <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>;
}
