import type { AppError, SerializedAppError } from "./types.js";

export function serializeError(error: AppError): SerializedAppError {
  return {
    name: "AppError",
    kind: error.kind,
    message: error.message,
    userMessage: error.userMessage,
    code: error.code,
    status: error.status,
    requestId: error.requestId,
    traceId: error.traceId,
    details: error.details,
    retryable: error.retryable,
    reportable: error.reportable,
    severity: error.severity,
    validationIssues: error.validationIssues,
    context: error.context,
  };
}
