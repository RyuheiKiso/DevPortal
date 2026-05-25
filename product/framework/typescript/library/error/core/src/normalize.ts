import { createAppError } from "./appError.js";
import { classifyErrorCode } from "./classify.js";
import { isAppError, isRecord, readString } from "./guards.js";
import { fromHttpError, isHttpErrorLike } from "./http.js";
import { fromValidationError, extractValidationIssues } from "./validation.js";
import type { AppError, ErrorContext, NormalizeOptions } from "./types.js";

function contextFromOptions(options: NormalizeOptions | undefined): ErrorContext | undefined {
  // オプション自体がない場合は context を作らない
  if (options === undefined) {
    return undefined;
  }
  // context として公開する項目だけを取り出す
  const { operation, component, requestId, traceId, tags, metadata } = options;
  // すべて未指定なら空 object を残さない
  if (
    operation === undefined &&
    component === undefined &&
    requestId === undefined &&
    traceId === undefined &&
    tags === undefined &&
    metadata === undefined
  ) {
    return undefined;
  }
  // 指定された context 情報を返す
  return { operation, component, requestId, traceId, tags, metadata };
}

export function normalizeError(error: unknown, options: NormalizeOptions = {}): AppError {
  const context = contextFromOptions(options);

  if (isAppError(error)) {
    return {
      ...error,
      context: error.context ?? context,
      requestId: error.requestId ?? context?.requestId,
      traceId: error.traceId ?? context?.traceId,
    };
  }

  if (extractValidationIssues(error).length > 0) {
    return fromValidationError(error, context);
  }

  if (isHttpErrorLike(error)) {
    return fromHttpError(error, context);
  }

  if (error instanceof Error) {
    const record = error as Error & { code?: string; cause?: unknown };
    const code = typeof record.code === "string" ? record.code : undefined;
    return createAppError({
      kind: classifyErrorCode(code) ?? options.defaultKind ?? "unknown",
      message: error.message,
      userMessage: options.defaultUserMessage,
      code,
      cause: options.includeCause === false ? undefined : record.cause ?? error,
      context,
    });
  }

  if (isRecord(error)) {
    const code = readString(error, "code");
    const message = readString(error, "message") ?? "Non-error object was thrown";
    return createAppError({
      kind: classifyErrorCode(code) ?? options.defaultKind ?? "unknown",
      message,
      userMessage: options.defaultUserMessage,
      code,
      details: error,
      cause: options.includeCause === false ? undefined : error,
      context,
    });
  }

  return createAppError({
    kind: options.defaultKind ?? "unknown",
    message: typeof error === "string" ? error : "Unknown thrown value",
    userMessage: options.defaultUserMessage,
    details: error,
    cause: options.includeCause === false ? undefined : error,
    context,
  });
}
