import type { AppErrorKind } from "./types.js";

export function classifyHttpStatus(status: number): AppErrorKind {
  if (status === 0) {
    return "network";
  }
  if (status === 408 || status === 504) {
    return "timeout";
  }
  if (status === 400 || status === 422) {
    return "validation";
  }
  if (status === 401) {
    return "auth";
  }
  if (status === 403) {
    return "permission";
  }
  if (status === 404) {
    return "notFound";
  }
  if (status === 409 || status === 412) {
    return "conflict";
  }
  if (status >= 500) {
    return "system";
  }
  return "http";
}

export function classifyErrorCode(code: string | undefined): AppErrorKind | undefined {
  if (code === undefined) {
    return undefined;
  }
  const normalized = code.toLowerCase();
  if (normalized.includes("timeout") || normalized === "etimedout") {
    return "timeout";
  }
  if (normalized.includes("network") || normalized === "econnrefused" || normalized === "enotfound") {
    return "network";
  }
  if (normalized.includes("validation") || normalized.includes("invalid")) {
    return "validation";
  }
  if (normalized.includes("auth") || normalized === "unauthorized") {
    return "auth";
  }
  if (normalized.includes("permission") || normalized === "forbidden") {
    return "permission";
  }
  if (normalized.includes("conflict")) {
    return "conflict";
  }
  if (normalized.includes("not_found") || normalized.includes("notfound")) {
    return "notFound";
  }
  return undefined;
}
