// Context と関連型を re-export
export { ErrorContext } from "./context.js";
export type { ErrorContextValue, ErrorLogger, ErrorNotification, HandleErrorOptions } from "./context.js";

// Provider と props 型を re-export
export { ErrorProvider } from "./ErrorProvider.js";
export type { ErrorProviderProps } from "./ErrorProvider.js";

// ErrorBoundary と HOC、関連型を re-export
export { ErrorBoundary, withErrorBoundary } from "./ErrorBoundary.js";
export type { ErrorBoundaryFallbackProps, ErrorBoundaryProps } from "./ErrorBoundary.js";

// hook 群を re-export
export { useAsyncErrorHandler, useErrorContext, useErrorHandler, useLastError } from "./hooks.js";

// React Native 専用: global error handler 登録ユーティリティ
export { registerNativeGlobalErrorHandler } from "./nativeGlobalHandler.js";
export type { NativeErrorUtilsLike, RegisterNativeGlobalErrorHandlerOptions } from "./nativeGlobalHandler.js";
