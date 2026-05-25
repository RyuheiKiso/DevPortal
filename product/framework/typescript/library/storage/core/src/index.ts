// 公開型をまとめて re-export (グループ化)
export type {
  AuditEvent,
  ClearScopeOptions,
  Codec,
  CryptoProvider,
  KvStore,
  Migration,
  MigrationError,
  QuotaError,
  StorageErrorLike,
  StorageNotAvailableError,
  StorageRegistry,
  StorageScope,
  SyncStorage,
  TypedSlot,
} from "./types.js";

// エラー関連の関数とガードを公開
export {
  createMigrationError,
  createNotAvailableError,
  createQuotaError,
  isMigrationError,
  isQuotaError,
  isQuotaExceededLike,
  isStorageNotAvailableError,
  toAppErrorShape,
} from "./errors.js";

// ストア生成関数
export { createMemoryStore } from "./memory.js";
export { createSyncBacked } from "./fromSync.js";

// スロット型付け
export { asKvStore, createTypedSlot } from "./typed.js";

// ミドルウェア (Phase 1 で公開する基本セット)
export { withNamespace } from "./namespace.js";
export { base64Codec, jsonCodec, stringCodec, withCodec } from "./codec.js";

// ミドルウェア (Phase 2: TTL / マイグレーション / 通知 / 多階層キャッシュ)
export { withTtl } from "./ttl.js";
export type { KvStoreWithTtl, TtlEnvelope, WithTtlOptions } from "./ttl.js";
export { withMigration } from "./migration.js";
export type { WithMigrationOptions } from "./migration.js";
export { withObservable } from "./observable.js";
export type { KvStoreObservable, WithObservableOptions } from "./observable.js";
export { withReadThroughCache } from "./readThroughCache.js";
export type { WithReadThroughCacheOptions, WriteThroughPolicy } from "./readThroughCache.js";

// ミドルウェア + Registry (Phase 3: 運用機能)
export { withQuotaGuard } from "./quota.js";
export type { QuotaDecision, WithQuotaGuardOptions } from "./quota.js";
export { withAudit } from "./audit.js";
export type { WithAuditOptions } from "./audit.js";
export { createAesGcmProvider, withEncryption } from "./encryption.js";
export type { WithEncryptionOptions } from "./encryption.js";
export { createStorageRegistry } from "./registry.js";
