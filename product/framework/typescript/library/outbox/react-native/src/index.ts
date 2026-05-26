// Provider
export { OutboxProvider } from "./OutboxProvider.js";
export type { OutboxProviderProps } from "./OutboxProvider.js";

// Context
export { OutboxContext } from "./context.js";

// Hooks
export {
  useOutbox,
  useOutboxAppend,
  useOutboxControls,
  useOutboxEntry,
  useOutboxEvents,
  useOutboxList,
  useOutboxStatus,
} from "./hooks.js";

// AsyncStorage adapter (React Native 専用 export)
export { createAsyncStorageKvStore } from "./asyncStorageAdapter.js";
export type {
  AsyncStorageLike,
  CreateAsyncStorageKvStoreOptions,
} from "./asyncStorageAdapter.js";

// core 型素通し
export type {
  AppendInput,
  ListOptions,
  OutboxEntry,
  OutboxEvent,
  OutboxEventType,
  OutboxListener,
  OutboxManager,
  OutboxManagerConfig,
  OutboxStatus,
  OutboxStorage,
  Publisher,
  PublishContext,
  RetryPolicy,
  SchedulerOptions,
} from "@k1s0-ts-outbox/core";
