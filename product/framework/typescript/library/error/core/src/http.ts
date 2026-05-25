import { createAppError } from "./appError.js";
import { classifyErrorCode, classifyHttpStatus } from "./classify.js";
import { isRecord, readNumber, readString } from "./guards.js";
import type { AppError, ErrorContext, HttpErrorLike } from "./types.js";

function readHeader(headers: HttpErrorLike["response"] extends infer R ? R extends { headers?: infer H } ? H : never : never, name: string): string | undefined {
  if (headers === undefined) {
    return undefined;
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
  }
  if (isRecord(headers)) {
    const direct = headers[name];
    const lower = headers[name.toLowerCase()];
    return typeof direct === "string" ? direct : typeof lower === "string" ? lower : undefined;
  }
  return undefined;
}

export function isHttpErrorLike(value: unknown): value is HttpErrorLike {
  // object 以外は HTTP エラーとして扱わない
  if (!isRecord(value)) {
    return false;
  }
  // status / statusCode / response のいずれかを持つものだけを HTTP 系として扱う
  return (
    readNumber(value, "status") !== undefined ||
    readNumber(value, "statusCode") !== undefined ||
    isRecord(value.response)
  );
}

export function fromHttpError(error: HttpErrorLike, context?: ErrorContext): AppError {
  const record = isRecord(error) ? error : {};
  const response = isRecord(error.response) ? error.response : undefined;
  const responseStatus = response === undefined ? undefined : readNumber(response, "status");
  const status = error.status ?? error.statusCode ?? responseStatus;
  const code = error.code ?? readString(record, "code");
  const kind = typeof status === "number" ? classifyHttpStatus(status) : classifyErrorCode(code) ?? "http";
  const headers = response?.headers as HttpErrorLike["response"] extends infer R ? R extends { headers?: infer H } ? H : never : never;
  const requestId = error.requestId ?? readHeader(headers, "x-request-id") ?? context?.requestId;
  const traceId = error.traceId ?? readHeader(headers, "traceparent") ?? context?.traceId;
  return createAppError({
    kind,
    message: error.message ?? `HTTP request failed${typeof status === "number" ? ` with status ${status}` : ""}`,
    code,
    status,
    requestId,
    traceId,
    details: error.details ?? response?.body ?? response?.data,
    cause: error.cause ?? error,
    context,
  });
}
