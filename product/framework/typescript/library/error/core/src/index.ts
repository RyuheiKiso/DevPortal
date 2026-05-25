// 公開型をまとめて re-export
export type {
  AppError,
  AppErrorInput,
  AppErrorKind,
  AppErrorSeverity,
  ErrorContext,
  HttpErrorLike,
  LogRecord,
  NormalizeOptions,
  NotificationInput,
  NotificationLevel,
  SerializedAppError,
  ValidationIssue,
} from "./types.js";

// 値配列（kind / severity の網羅処理に利用）も公開
export { appErrorKindValues, appErrorSeverityValues } from "./types.js";

// AppError ファクトリ
export { createAppError } from "./appError.js";

// kind 分類ユーティリティ
export { classifyErrorCode, classifyHttpStatus } from "./classify.js";

// 型ガード・record ヘルパ
export { isAppError, isRecord, isSerializedAppError } from "./guards.js";

// kind 既定値ヘルパ群（既定 message / severity / retryable / reportable）
export { defaultReportable, defaultRetryable, defaultSeverity, defaultUserMessage } from "./message.js";

// HTTP エラー判定 / 変換
export { isHttpErrorLike, fromHttpError } from "./http.js";

// 検証エラー issue 抽出 / 変換
export { extractValidationIssues, fromValidationError } from "./validation.js";

// 任意の例外値を AppError に正規化するエントリポイント
export { normalizeError } from "./normalize.js";

// AppError と SerializedAppError の相互変換
export { deserializeAppError, serializeError } from "./serialize.js";

// 構造化ログ・通知アダプタへの変換
export { toLogRecord, toNotification } from "./adapters.js";

// zod schema 群と検証関数
export {
  appErrorInputSchema,
  appErrorKindSchema,
  appErrorSeveritySchema,
  errorContextSchema,
  safeValidateAppErrorInput,
  validateAppErrorInput,
  validationIssueSchema,
} from "./schema.js";

// safeValidateAppErrorInput の戻り値型
export type { SafeAppErrorInputResult } from "./schema.js";
