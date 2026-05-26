// 公開型
export type {
  AppendInput,
  HttpClientLike,
  HttpRequestInitLike,
  HttpResponseLike,
  ListOptions,
  OutboxEntry,
  OutboxEvent,
  OutboxEventType,
  OutboxListener,
  OutboxLogger,
  OutboxManager,
  OutboxManagerConfig,
  OutboxStatus,
  OutboxStorage,
  OutboxTimer,
  PublishContext,
  Publisher,
  RetryPolicy,
  SchedulerOptions,
} from "./types.js";

// マネージャ
export { createOutboxManager } from "./manager.js";

// 永続化アダプタ
export { createOutboxStorage } from "./storage.js";
export type { CreateOutboxStorageOptions, KvStoreLike } from "./storage.js";

// HTTP publisher プリセット
export {
  createHttpPublisher,
  DEFAULT_RETRYABLE_STATUSES,
  IDEMPOTENCY_KEY_HEADER,
} from "./httpPublisher.js";
export type { CreateHttpPublisherOptions } from "./httpPublisher.js";

// publisher ヘルパ
export { composePublishers, createNoopPublisher } from "./publisher.js";

// scheduler
export { createOutboxScheduler } from "./scheduler.js";
export type {
  CreateOutboxSchedulerOptions,
  OutboxScheduler,
} from "./scheduler.js";

// イベントエミッタ (拡張・テスト用に export)
export { OutboxEventEmitter } from "./events.js";

// リトライポリシ
export { computeBackoff, DEFAULT_RETRY_POLICY, mergeRetryPolicy, shouldRetryEntry } from "./retry.js";

// DLQ ヘルパ
export { buildDlqEntry, buildRestoredEntry, selectAutoArchiveIds } from "./dlq.js";

// dedupe ヘルパ
export { findEntryByDedupeKey } from "./dedupe.js";

// id factory
export { createDefaultIdFactory, fallbackId } from "./id.js";

// schema (zod スキーマ + 検証関数)
export {
  dlqAutoArchiveSchema,
  outboxManagerConfigSchema,
  retryPolicySchema,
  schedulerOptionsSchema,
  validateOutboxManagerConfig,
} from "./schema.js";
export type { OutboxManagerConfigInput } from "./schema.js";

// エラー
export { isOutboxError, normalizeError, OutboxError, toEntryError } from "./errors.js";
export type { OutboxErrorCode, OutboxErrorInit } from "./errors.js";
