// React の Context API を取り込み
import { createContext } from "react";
// core の公開型を取り込み
import type { AppError, ErrorContext as CoreErrorContext, NormalizeOptions } from "@k1s0-ts-error/core";

// 構造化ログを書き出す最小インターフェース（@k1s0-ts-logger 等と互換）
export interface ErrorLogger {
  // 重要度 error 相当のログを書き出す
  error(message: string, data?: unknown): void;
}

// 通知（toast 等）を表示する最小インターフェース（@k1s0-ts-notification 等と互換）
export interface ErrorNotification {
  // 通知 input を受け取って表示する
  show(input: unknown): void;
}

// handleError に渡せる追加オプション（NormalizeOptions を継承して context を直渡し可能）
export interface HandleErrorOptions extends NormalizeOptions {
  // 通知表示を抑制する場合は false
  notify?: boolean;
  // ログ出力を抑制する場合は false
  log?: boolean;
}

// Context が提供する API 一式
export interface ErrorContextValue {
  // 直近の処理済み AppError（無ければ null）
  lastError: AppError | null;
  // 任意の例外を AppError 化 + ログ/通知/コールバック実行
  handleError(error: unknown, options?: HandleErrorOptions): AppError;
  // lastError を null に戻す
  clearError(): void;
  // ログや通知を伴わずに正規化だけ行うユーティリティ
  normalize(error: unknown, context?: CoreErrorContext): AppError;
}

// Provider 外で hook を使ったときに null として検出できるよう、初期値は null
export const ErrorContext = createContext<ErrorContextValue | null>(null);
