// アダプタを公開
export { createLocalStorageBackend } from "./localStorage.js";
export type { CreateLocalStorageBackendOptions } from "./localStorage.js";
export { createSessionStorageBackend } from "./sessionStorage.js";
export type { CreateSessionStorageBackendOptions } from "./sessionStorage.js";
export { createIndexedDbBackend } from "./indexedDB.js";
export type { CreateIndexedDbBackendOptions } from "./indexedDB.js";
export { createCookieBackend } from "./cookie.js";
export type { CookieAttributes, CreateCookieBackendOptions } from "./cookie.js";

// cross-tab 連携ヘルパ
export { attachStorageEvents } from "./storageEvent.js";
export type { AttachStorageEventsOptions } from "./storageEvent.js";

// React 統合
export { StorageContext } from "./context.js";
export { StorageProvider } from "./StorageProvider.js";
export type { StorageProviderProps } from "./StorageProvider.js";
export {
  useStorageRegistry,
  useStorageScope,
  useStorageValue,
  useTypedSlot,
} from "./hooks.js";
export type { UseStorageStateResult, UseStorageValueOptions } from "./hooks.js";
