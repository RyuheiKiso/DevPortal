import { createAppError } from "./appError.js";
import { isRecord, readString } from "./guards.js";
import type { AppError, ErrorContext, ValidationIssue } from "./types.js";

function isPath(value: unknown): value is readonly (string | number)[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number");
}

export function extractValidationIssues(value: unknown): readonly ValidationIssue[] {
  if (!isRecord(value) || !Array.isArray(value.issues)) {
    return [];
  }

  return value.issues
    .map((issue): ValidationIssue | null => {
      if (!isRecord(issue)) {
        return null;
      }
      const message = readString(issue, "message");
      if (message === undefined) {
        return null;
      }
      const path = isPath(issue.path) ? issue.path : undefined;
      return {
        path,
        code: readString(issue, "code"),
        message,
      };
    })
    .filter((issue): issue is ValidationIssue => issue !== null);
}

export function fromValidationError(error: unknown, context?: ErrorContext): AppError {
  const issues = extractValidationIssues(error);
  const firstIssue = issues[0];
  const message = isRecord(error) && typeof error.message === "string" ? error.message : "Validation failed";
  return createAppError({
    kind: "validation",
    message,
    userMessage: firstIssue?.message ?? "Please check the entered values.",
    details: error,
    cause: error,
    reportable: false,
    validationIssues: issues.length > 0 ? issues : undefined,
    context,
  });
}
