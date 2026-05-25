import { createContext } from "react";
import type { AppError, ErrorContext as CoreErrorContext, NormalizeOptions } from "@k1s0-ts-error/core";

export interface ErrorLogger {
  error(message: string, data?: unknown): void;
}

export interface ErrorNotification {
  show(input: unknown): void;
}

export interface HandleErrorOptions extends NormalizeOptions {
  notify?: boolean;
  log?: boolean;
}

export interface ErrorContextValue {
  lastError: AppError | null;
  handleError(error: unknown, options?: HandleErrorOptions): AppError;
  clearError(): void;
  normalize(error: unknown, context?: CoreErrorContext): AppError;
}

export const ErrorContext = createContext<ErrorContextValue | null>(null);
