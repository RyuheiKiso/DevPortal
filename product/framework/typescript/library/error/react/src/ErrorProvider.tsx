// React の型と hook を取り込み
import type { ReactElement, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
// core の正規化・アダプタ・型を取り込み
import {
  normalizeError,
  toLogRecord,
  toNotification,
  type AppError,
  type ErrorContext as CoreErrorContext,
} from "@k1s0-ts-error/core";
// Context と関連型を取り込み
import { ErrorContext, type ErrorLogger, type ErrorNotification, type HandleErrorOptions } from "./context.js";

// Provider に渡す props
export interface ErrorProviderProps {
  // 配下の React 要素
  children: ReactNode;
  // 構造化ログを書き出すアダプタ（未指定なら何もしない）
  logger?: ErrorLogger;
  // 通知を表示するアダプタ（未指定なら何もしない）
  notification?: ErrorNotification;
  // すべての handleError 呼び出しで実行されるコールバック
  onError?: (error: AppError) => void;
  // kind="auth" の AppError が発生したときのコールバック（401 系のサインアウト導線などに利用）
  onUnauthorized?: (error: AppError) => void;
  // kind="permission" の AppError が発生したときのコールバック（403 系のフォールバック表示）
  onForbidden?: (error: AppError) => void;
}

// ErrorContext を提供する Provider
export function ErrorProvider(props: ErrorProviderProps): ReactElement {
  // props を分解（依存配列にそのまま使うため）
  const { children, logger, notification, onError, onForbidden, onUnauthorized } = props;
  // 直近の AppError を state として保持
  const [lastError, setLastError] = useState<AppError | null>(null);

  // lastError を null に戻すヘルパ
  const clearError = useCallback(() => setLastError(null), []);

  // 正規化だけ実行するユーティリティ（副作用なし）
  const normalize = useCallback(
    (error: unknown, context?: CoreErrorContext): AppError => normalizeError(error, context),
    [],
  );

  // 例外を AppError 化し、ログ・通知・コールバックを一括で呼び出す本体
  const handleError = useCallback(
    (caught: unknown, options: HandleErrorOptions = {}): AppError => {
      // 例外を AppError に正規化
      const appError = normalizeError(caught, options);
      // 最新の AppError を state に保持
      setLastError(appError);

      // log:false が明示されていない限り logger を呼ぶ
      if (options.log !== false) {
        logger?.error(appError.message, toLogRecord(appError));
      }

      // notify:false が明示されていない限り notification を呼ぶ
      if (options.notify !== false) {
        notification?.show(toNotification(appError));
      }

      // 共通コールバックを呼ぶ
      onError?.(appError);
      // 認証系は dedicated コールバックも呼ぶ
      if (appError.kind === "auth") {
        onUnauthorized?.(appError);
      }
      // 認可系も同様
      if (appError.kind === "permission") {
        onForbidden?.(appError);
      }

      // 呼び出し側にも AppError を返す
      return appError;
    },
    [logger, notification, onError, onForbidden, onUnauthorized],
  );

  // 値オブジェクトをメモ化（不要な再レンダリングを避ける）
  const value = useMemo(
    () => ({ lastError, handleError, clearError, normalize }),
    [clearError, handleError, lastError, normalize],
  );

  // Context.Provider 経由で API を配下に流す
  return <ErrorContext.Provider value={value}>{children}</ErrorContext.Provider>;
}
