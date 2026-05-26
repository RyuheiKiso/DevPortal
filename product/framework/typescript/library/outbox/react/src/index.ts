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

// core 型を素通しで re-export して利用側が単一 import で済むようにする
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
