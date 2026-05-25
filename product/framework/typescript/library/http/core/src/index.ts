// 公開型の re-export（型のみ）
export type {
  AuthProvider,
  ErrorInterceptor,
  HttpClient,
  HttpClientConfig,
  HttpMethod,
  HttpRequest,
  HttpRequestInit,
  HttpResponse,
  Logger,
  RequestIdGenerator,
  RequestInterceptor,
  ResponseInterceptor,
  RetryPolicy,
  TimeoutPolicy,
} from "./types.js";

// エラー関連
export { HttpError, normalizeError, isRetryableError } from "./errors.js";
export type { HttpErrorInit } from "./errors.js";

// requestId
export {
  REQUEST_ID_HEADER,
  TRACEPARENT_HEADER,
  createRequestId,
  createTraceparent,
} from "./requestId.js";

// retry / timeout（外部からポリシー操作するための公開 API）
export {
  DEFAULT_RETRYABLE_STATUSES,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_METHODS,
  mergeRetryDefaults,
  sleep,
  withRetry,
} from "./retry.js";
export { withTimeout } from "./timeout.js";

// auth ヘルパ
export { createBearerAuth, createStaticAuth } from "./auth.js";

// interceptor 実行ヘルパ（高度な利用者向け）
export {
  runErrorInterceptors,
  runRequestInterceptors,
  runResponseInterceptors,
} from "./interceptors.js";

// logger ヘルパ
export { noopLogger } from "./logging.js";

// クライアント本体
export { createHttpClient } from "./client.js";

// schema
export {
  grpcClientConfigSchema,
  httpClientConfigSchema,
  retryPolicySchema,
  timeoutPolicySchema,
  validateGrpcClientConfig,
  validateHttpClientConfig,
} from "./schema.js";

// rest サブモジュール
export * from "./rest/index.js";

// grpc サブモジュール
export * from "./grpc/index.js";
