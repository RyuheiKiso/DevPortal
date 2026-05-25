import { z } from "zod";
import type { AppErrorInput } from "./types.js";

export const appErrorKindSchema = z.enum([
  "network",
  "timeout",
  "http",
  "auth",
  "permission",
  "validation",
  "business",
  "conflict",
  "notFound",
  "system",
  "unknown",
]);

export const appErrorSeveritySchema = z.enum(["info", "warning", "error", "critical"]);

export const validationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])).optional(),
  code: z.string().optional(),
  message: z.string(),
});

export const errorContextSchema = z.object({
  operation: z.string().optional(),
  component: z.string().optional(),
  requestId: z.string().optional(),
  traceId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const appErrorInputSchema: z.ZodType<AppErrorInput> = z.object({
  kind: appErrorKindSchema,
  message: z.string().optional(),
  userMessage: z.string().optional(),
  code: z.string().optional(),
  status: z.number().int().optional(),
  requestId: z.string().optional(),
  traceId: z.string().optional(),
  details: z.unknown().optional(),
  cause: z.unknown().optional(),
  retryable: z.boolean().optional(),
  reportable: z.boolean().optional(),
  severity: appErrorSeveritySchema.optional(),
  validationIssues: z.array(validationIssueSchema).optional(),
  context: errorContextSchema.optional(),
});

export function validateAppErrorInput(input: unknown): AppErrorInput {
  return appErrorInputSchema.parse(input);
}
