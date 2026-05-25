export type AppErrorKind =
  | "network"
  | "timeout"
  | "http"
  | "auth"
  | "permission"
  | "validation"
  | "business"
  | "conflict"
  | "notFound"
  | "system"
  | "unknown";

export type AppErrorSeverity = "info" | "warning" | "error" | "critical";

export interface ErrorContext {
  operation?: string;
  component?: string;
  requestId?: string;
  traceId?: string;
  tags?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface ValidationIssue {
  path?: readonly (string | number)[];
  code?: string;
  message: string;
}

export interface AppErrorInput {
  kind: AppErrorKind;
  message?: string;
  userMessage?: string;
  code?: string;
  status?: number;
  requestId?: string;
  traceId?: string;
  details?: unknown;
  cause?: unknown;
  retryable?: boolean;
  reportable?: boolean;
  severity?: AppErrorSeverity;
  validationIssues?: readonly ValidationIssue[];
  context?: ErrorContext;
}

export interface AppError {
  name: "AppError";
  kind: AppErrorKind;
  message: string;
  userMessage: string;
  code?: string;
  status?: number;
  requestId?: string;
  traceId?: string;
  details?: unknown;
  cause?: unknown;
  retryable: boolean;
  reportable: boolean;
  severity: AppErrorSeverity;
  validationIssues?: readonly ValidationIssue[];
  context?: ErrorContext;
}

export interface SerializedAppError {
  name: "AppError";
  kind: AppErrorKind;
  message: string;
  userMessage: string;
  code?: string;
  status?: number;
  requestId?: string;
  traceId?: string;
  details?: unknown;
  retryable: boolean;
  reportable: boolean;
  severity: AppErrorSeverity;
  validationIssues?: readonly ValidationIssue[];
  context?: ErrorContext;
}

export interface NormalizeOptions extends ErrorContext {
  defaultKind?: AppErrorKind;
  defaultUserMessage?: string;
  includeCause?: boolean;
}

export interface HttpErrorLike {
  name?: string;
  message?: string;
  status?: number;
  statusCode?: number;
  code?: string;
  requestId?: string;
  traceId?: string;
  response?: {
    status?: number;
    headers?: Headers | Record<string, string | undefined>;
    body?: unknown;
    data?: unknown;
  };
  details?: unknown;
  cause?: unknown;
}

export interface LogRecord {
  errorName: "AppError";
  kind: AppErrorKind;
  severity: AppErrorSeverity;
  message: string;
  userMessage: string;
  code?: string;
  status?: number;
  requestId?: string;
  traceId?: string;
  retryable: boolean;
  reportable: boolean;
  details?: unknown;
  validationIssues?: readonly ValidationIssue[];
  context?: ErrorContext;
}

export type NotificationLevel = "info" | "warning" | "error";

export interface NotificationInput {
  kind: "toast";
  level: NotificationLevel;
  title: string;
  message: string;
  dedupeKey?: string;
}
