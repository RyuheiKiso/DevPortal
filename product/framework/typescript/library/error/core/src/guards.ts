import type { AppError } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readString(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

export function isAppError(value: unknown): value is AppError {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.name === "AppError" &&
    typeof value.kind === "string" &&
    typeof value.message === "string" &&
    typeof value.userMessage === "string" &&
    typeof value.retryable === "boolean" &&
    typeof value.reportable === "boolean"
  );
}
