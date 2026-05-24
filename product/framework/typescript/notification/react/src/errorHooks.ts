// React の hook を取り込み
import { useCallback, useEffect, useRef } from "react";
// core の HttpError 連携機能を取り込み
import {
  fromHttpError,
  isHttpErrorLike,
  type FromHttpErrorOptions,
  type ToastInput,
} from "@k1s0-ts-notification/core";
// 既存の hook を取り込み（manager 取得用）
import { useNotification } from "./hooks.js";

// useHttpErrorHandler のオプション
export interface UseHttpErrorHandlerOptions extends FromHttpErrorOptions {
  // HttpErrorLike でない値を渡された場合の代替 toast 入力（既定は { level:"error", message:String(err) }）
  fallback?: (err: unknown) => ToastInput;
}

// HTTP エラーを toast に流すハンドラを返す hook
// React Query や useMutation の onError などで `(err) => handleError(err)` の形で使う
// 戻り値の関数は manager が変わらない限り参照同一性を保つ（options を毎回新規オブジェクトで渡してもループしない）
export function useHttpErrorHandler(
  options: UseHttpErrorHandlerOptions = {},
): (err: unknown) => string {
  // Manager 取得（Provider 外なら throw）
  const manager = useNotification();
  // 最新の options を ref で保持（useCallback の依存に含めずに参照同一性を保つため）
  // useRef の initial value で初回 render 時点の options を入れておき、
  // 以降は useEffect（依存配列なし＝毎レンダリング後）でコミットフェーズに最新化する
  // → render 中の ref 書き込みを避ける React 公式パターン
  const optionsRef = useRef<UseHttpErrorHandlerOptions>(options);
  // 再 render 後のコミットフェーズで ref を最新化（StrictMode の二重実行でも冪等）
  // 依存配列に options を明示することで react-hooks/exhaustive-deps の警告を回避
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  // 関数本体は manager のみに依存する形で安定化
  return useCallback(
    (err: unknown) => {
      // ref から最新 options を取り出す
      const opts = optionsRef.current;
      // HttpErrorLike なら fromHttpError 経由で標準入力に変換
      if (isHttpErrorLike(err)) {
        return manager.toast(fromHttpError(err, opts));
      }
      // それ以外は fallback を使う（未指定なら最小の error toast）
      const input = opts.fallback?.(err) ?? {
        level: "error" as const,
        message: err instanceof Error ? err.message : String(err),
      };
      // toast を発行して ID を返す
      return manager.toast(input);
    },
    [manager],
  );
}
