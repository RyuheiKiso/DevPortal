import type { AppErrorKind, AppErrorSeverity } from "./types.js";

const DEFAULT_MESSAGES: Readonly<Record<AppErrorKind, string>> = {
  network: "Network communication failed. Please check your connection.",
  timeout: "The request timed out. Please try again.",
  http: "The request failed.",
  auth: "Please sign in again.",
  permission: "You do not have permission to perform this operation.",
  validation: "Please check the entered values.",
  business: "The operation could not be completed.",
  conflict: "The data was updated by another operation. Please reload and try again.",
  notFound: "The requested data was not found.",
  system: "A system error occurred. Please contact support if the problem continues.",
  unknown: "An unexpected error occurred.",
};

export function defaultUserMessage(kind: AppErrorKind): string {
  return DEFAULT_MESSAGES[kind];
}

export function defaultSeverity(kind: AppErrorKind): AppErrorSeverity {
  if (kind === "system" || kind === "unknown") {
    return "critical";
  }
  if (kind === "validation" || kind === "business" || kind === "conflict" || kind === "notFound") {
    return "warning";
  }
  return "error";
}

export function defaultRetryable(kind: AppErrorKind, status?: number): boolean {
  if (kind === "network" || kind === "timeout") {
    return true;
  }
  if (typeof status === "number") {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return false;
}

export function defaultReportable(kind: AppErrorKind): boolean {
  return kind === "system" || kind === "unknown" || kind === "http" || kind === "network" || kind === "timeout";
}
