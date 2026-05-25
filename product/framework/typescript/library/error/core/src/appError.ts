import type { AppError, AppErrorInput } from "./types.js";
import { defaultReportable, defaultRetryable, defaultSeverity, defaultUserMessage } from "./message.js";

export function createAppError(input: AppErrorInput): AppError {
  const userMessage = input.userMessage ?? defaultUserMessage(input.kind);
  return {
    name: "AppError",
    kind: input.kind,
    message: input.message ?? userMessage,
    userMessage,
    code: input.code,
    status: input.status,
    requestId: input.requestId,
    traceId: input.traceId,
    details: input.details,
    cause: input.cause,
    retryable: input.retryable ?? defaultRetryable(input.kind, input.status),
    reportable: input.reportable ?? defaultReportable(input.kind),
    severity: input.severity ?? defaultSeverity(input.kind),
    validationIssues: input.validationIssues,
    context: input.context,
  };
}
