// 公開型
export type {
  KeychainModule,
  MmkvInstance,
  NativeKeyValueStorage,
  SecureNativeStorage,
} from "./types.js";

// アダプタ
export { createAsyncStorageBackend } from "./asyncStorage.js";
export { createExpoSecureStoreBackend } from "./expoSecureStore.js";
export { createKeychainBackend } from "./keychain.js";
export type { CreateKeychainBackendOptions } from "./keychain.js";
export { createMmkvBackend } from "./mmkv.js";

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
