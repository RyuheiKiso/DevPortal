// React の hook 群を取り込み
import { useCallback, useContext, useEffect, useRef } from "react";
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

// 主要 API だけを返す軽量 hook（呼び出し側の依存を絞る）
export function useErrorHandler(): Pick<ErrorContextValue, "handleError" | "clearError" | "lastError"> {
  const { handleError, clearError, lastError } = useErrorContext();
  return { handleError, clearError, lastError };
}

// 直近の AppError だけを購読するための専用 hook
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
  // 最新の options を ref に反映する
  // 旧実装は render 中に `optionsRef.current = options` を直接書き込んでいたため、
  // Concurrent React で render が破棄されても optionsRef が古い値で固まりうる不整合があった。
  // useEffect 内で commit 後にのみ更新することで、画面に反映された options のみが ref に残る。
  useEffect(() => {
    optionsRef.current = options;
  });
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
