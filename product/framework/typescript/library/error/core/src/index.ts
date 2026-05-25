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

export { createAppError } from "./appError.js";
export { classifyErrorCode, classifyHttpStatus } from "./classify.js";
export { isAppError, isRecord } from "./guards.js";
export { defaultReportable, defaultRetryable, defaultSeverity, defaultUserMessage } from "./message.js";
export { isHttpErrorLike, fromHttpError } from "./http.js";
export { extractValidationIssues, fromValidationError } from "./validation.js";
export { normalizeError } from "./normalize.js";
export { serializeError } from "./serialize.js";
export { toLogRecord, toNotification } from "./adapters.js";
export {
  appErrorInputSchema,
  appErrorKindSchema,
  appErrorSeveritySchema,
  errorContextSchema,
  validateAppErrorInput,
  validationIssueSchema,
} from "./schema.js";
