// React の hook 群を取り込み
import { useCallback, useContext, useRef } from "react";
// core の公開型を取り込み
import type { AppError } from "@k1s0-ts-error/core";
// Context 値と関連型を取り込み
import { ErrorContext, type ErrorContextValue, type HandleErrorOptions } from "./context.js";

// Provider 外で hook を呼んだら例外を投げて誤用を即座に検出する
function ensureContext(value: ErrorContextValue | null): ErrorContextValue {
  if (value === null) {
    throw new Error("useErrorHandler must be called inside <ErrorProvider>");
  }
  return value;
}

// ErrorContext を取得（Provider 外なら throw）
export function useErrorContext(): ErrorContextValue {
  return ensureContext(useContext(ErrorContext));
}

// 主要 API だけを返す軽量 hook
export function useErrorHandler(): Pick<ErrorContextValue, "handleError" | "clearError" | "lastError"> {
  const { handleError, clearError, lastError } = useErrorContext();
  return { handleError, clearError, lastError };
}

// 直近の AppError だけを購読する hook
export function useLastError(): AppError | null {
  return useErrorContext().lastError;
}

// 非同期関数を error handler で包むユーティリティ hook
// options は ref で安定化することで、毎レンダ生成しても useCallback の参照が変わらないようにする
export function useAsyncErrorHandler<TArgs extends readonly unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options?: HandleErrorOptions,
): (...args: TArgs) => Promise<TResult | undefined> {
  // Context から handleError を取り出す
  const { handleError } = useErrorContext();
  // options を ref に保持して useCallback の依存配列から外す
  const optionsRef = useRef(options);
  // 毎レンダで最新の options を ref に反映
  optionsRef.current = options;
  // 失敗時は handleError へ委譲し、戻り値を undefined にして上位 await を継続させる
  return useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      try {
        return await fn(...args);
      } catch (caught) {
        handleError(caught, optionsRef.current);
        return undefined;
      }
    },
    [fn, handleError],
  );
}
