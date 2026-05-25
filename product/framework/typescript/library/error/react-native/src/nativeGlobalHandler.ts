// core の正規化ロジックと公開型を取り込み
import { normalizeError, type AppError, type NormalizeOptions } from "@k1s0-ts-error/core";

// React Native の ErrorUtils 互換インターフェース（型定義のみを依存に持つ）
export interface NativeErrorUtilsLike {
  // 既存の global handler を取得（実装によっては未提供）
  getGlobalHandler?(): (error: unknown, isFatal?: boolean) => void;
  // global handler を設定
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

// register 関数に渡すオプション
export interface RegisterNativeGlobalErrorHandlerOptions {
  // テストやモック差し替え用の ErrorUtils（省略時は globalThis.ErrorUtils）
  errorUtils?: NativeErrorUtilsLike;
  // normalizeError に渡す追加オプション（component 名などを上書き可能）
  normalizeOptions?: NormalizeOptions;
  // 正規化済み AppError と fatal フラグを受け取るコールバック
  onError(error: AppError, isFatal: boolean): void;
  // 既存 handler も併せて呼ぶか（true で connect-style chain を維持）
  callPrevious?: boolean;
}

// 引数の errorUtils を優先しつつ、未指定なら global の ErrorUtils を取り出す
function resolveErrorUtils(errorUtils?: NativeErrorUtilsLike): NativeErrorUtilsLike | undefined {
  // 明示指定があればそれを返す
  if (errorUtils !== undefined) {
    return errorUtils;
  }
  // React Native ランタイムが globalThis に張る ErrorUtils を参照
  return (globalThis as { ErrorUtils?: NativeErrorUtilsLike }).ErrorUtils;
}

// React Native の global error handler を登録するエントリポイント
// 戻り値の関数を呼ぶと previous handler に巻き戻る
export function registerNativeGlobalErrorHandler(
  options: RegisterNativeGlobalErrorHandlerOptions,
): () => void {
  // ErrorUtils を解決（無ければ明示エラー）
  const errorUtils = resolveErrorUtils(options.errorUtils);
  if (errorUtils === undefined) {
    throw new Error("React Native ErrorUtils is not available");
  }

  // 既存 handler を取得（実装が getGlobalHandler を提供しない場合は undefined）
  const previous = errorUtils.getGlobalHandler?.();
  // 新しい handler 本体
  const handler = (caught: unknown, isFatal = false): void => {
    // component 名を既定値で上書きしつつ、呼び出し側が指定した normalizeOptions も適用
    const error = normalizeError(caught, {
      component: "ReactNativeGlobalErrorHandler",
      ...options.normalizeOptions,
    });
    // 正規化結果を呼び出し側へ通知
    options.onError(error, isFatal);
    // callPrevious=true のときだけ既存 handler にも引き渡す
    if (options.callPrevious === true) {
      previous?.(caught, isFatal);
    }
  };

  // global handler を入れ替え
  errorUtils.setGlobalHandler(handler);

  // unregister 関数を返す（previous が無ければ noop 相当）
  return () => {
    if (previous !== undefined) {
      errorUtils.setGlobalHandler(previous);
    }
  };
}
