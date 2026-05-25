// 公開型を re-export（実体コードは生成しない）
export type {
  NotificationLevel,
  NotificationKind,
  NotificationActionIntent,
  NotificationAction,
  BaseNotification,
  ToastNotification,
  DialogNotification,
  ConfirmNotification,
  Notification,
  ToastInput,
  DialogInput,
  ConfirmInput,
  DialogResult,
  NotificationEvent,
  NotificationEventType,
  NotificationListener,
  NotificationManager,
  NotificationManagerConfig,
  NotificationTimer,
} from "./types.js";

// レベルユーティリティを公開
export { NOTIFICATION_LEVELS, LEVEL_RANK, compareLevel, isHigherLevel } from "./levels.js";

// ID 生成ヘルパを公開（カスタム manager の構築用）
export { createDefaultIdFactory, fallbackId } from "./id.js";

// dedupe ヘルパを公開
export { findByDedupeKey } from "./dedupe.js";

// Manager 本体を公開
export { createNotificationManager } from "./manager.js";

// zod スキーマと validation ヘルパを公開
export {
  notificationLevelSchema,
  notificationConfigSchema,
  validateNotificationConfig,
} from "./schema.js";
export type { NotificationConfigInput } from "./schema.js";

// HttpError 連携を公開
export {
  isHttpErrorLike,
  resolveDefaultMapping,
  fromHttpError,
} from "./httpError.js";
export type { HttpErrorLike, ErrorMappingEntry, FromHttpErrorOptions } from "./httpError.js";
