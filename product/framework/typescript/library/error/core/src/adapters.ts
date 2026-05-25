import type { AppError, LogRecord, NotificationInput, NotificationLevel } from "./types.js";

function notificationLevel(error: AppError): NotificationLevel {
  if (error.severity === "info") {
    return "info";
  }
  if (error.severity === "warning") {
    return "warning";
  }
  return "error";
}

export function toLogRecord(error: AppError): LogRecord {
  return {
    errorName: "AppError",
    kind: error.kind,
    severity: error.severity,
    message: error.message,
    userMessage: error.userMessage,
    code: error.code,
    status: error.status,
    requestId: error.requestId,
    traceId: error.traceId,
    retryable: error.retryable,
    reportable: error.reportable,
    details: error.details,
    validationIssues: error.validationIssues,
    context: error.context,
  };
}

export function toNotification(error: AppError): NotificationInput {
  return {
    kind: "toast",
    level: notificationLevel(error),
    title: error.kind === "validation" ? "Input error" : "Error",
    message: error.userMessage,
    dedupeKey: error.code ?? error.kind,
  };
}
