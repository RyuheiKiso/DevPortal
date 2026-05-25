// React の hook を取り込み
import { useCallback, useEffect, useRef } from "react";
// core の HttpError 連携を取り込み
import {
  fromHttpError,
  isHttpErrorLike,
  type FromHttpErrorOptions,
  type ToastInput,
} from "@k1s0-ts-notification/core";
// 既存の hook を取り込み
import { useNotification } from "./hooks.js";

// useHttpErrorHandler のオプション
export interface UseHttpErrorHandlerOptions extends FromHttpErrorOptions {
  // HttpErrorLike 以外の値を渡された場合の代替 toast 入力
  fallback?: (err: unknown) => ToastInput;
}

// HTTP エラーを toast に流すハンドラを返す hook（RN 用、内部は React 版と同等）
// 戻り値の関数は manager が変わらない限り参照同一性を保つ
export function useHttpErrorHandler(
  options: UseHttpErrorHandlerOptions = {},
): (err: unknown) => string {
  // Manager 取得
  const manager = useNotification();
  // 最新 options を ref で保持して関数参照を安定化
  // useRef の initial value で初回 render 時点の options を入れておき、
  // 以降は useEffect（依存配列なし）でコミットフェーズに最新化する（React 公式パターン）
  const optionsRef = useRef<UseHttpErrorHandlerOptions>(options);
  // 再 render 後のコミットフェーズで ref を最新化
  // 依存配列に options を明示することで react-hooks/exhaustive-deps の警告を回避
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  // 関数本体は manager のみに依存
  return useCallback(
    (err: unknown) => {
      // ref から最新 options を取り出す
      const opts = optionsRef.current;
      // HttpErrorLike なら標準マッピングで変換
      if (isHttpErrorLike(err)) {
        return manager.toast(fromHttpError(err, opts));
      }
      // それ以外は fallback または既定の error toast
      const input = opts.fallback?.(err) ?? {
        level: "error" as const,
        message: err instanceof Error ? err.message : String(err),
      };
      return manager.toast(input);
    },
    [manager],
  );
}
