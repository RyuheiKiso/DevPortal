// Context 型と本体を公開する
export { AuthContext } from "./context.js";
export type { AuthContextValue } from "./context.js";

// Provider を公開する
export { AuthProvider } from "./AuthProvider.js";
export type { AuthProviderProps } from "./AuthProvider.js";

// hooks を公開する
export {
  useAccess,
  useAuth,
  useAuthContext,
  useAuthSession,
  useCurrentUser,
  useIsAuthenticated,
  usePermission,
  useRole,
} from "./hooks.js";

// 表示ガードを公開する
export { RequireAuth } from "./RequireAuth.js";
export type { RequireAuthProps } from "./RequireAuth.js";
export { RequirePermission } from "./RequirePermission.js";
export type { RequirePermissionProps } from "./RequirePermission.js";

// React Native storage adapter を公開する
// createNativeTokenStore: 汎用 backend (AsyncStorage 互換) を受ける低レベル API
// createKeychainTokenStore / createSecureStoreTokenStore: トークン用途の推奨パス
export {
  createKeychainTokenStore,
  createNativeTokenStore,
  createSecureStoreTokenStore,
} from "./storage.js";
export type {
  CreateKeychainTokenStoreOptions,
  CreateSecureStoreTokenStoreOptions,
  NativeKeyValueStorage,
} from "./storage.js";
