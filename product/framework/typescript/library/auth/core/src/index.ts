// 公開型の re-export
export type {
  AccessDecision,
  AccessMode,
  AccessRequirement,
  AuthAdapter,
  AuthEvent,
  AuthListener,
  AuthManager,
  AuthManagerOptions,
  AuthSession,
  AuthStatus,
  AuthTokenSet,
  AuthUser,
  GetSessionOptions,
  SignInRequest,
  SignOutRequest,
  TokenStore,
} from "./types.js";

// セッション関連 API
export { createAnonymousSession, isAuthenticated, normalizeSession } from "./session.js";

// トークン関連 API
export {
  createAuthorizationHeader,
  createMemoryTokenStore,
  isTokenExpired,
  shouldRefreshToken,
} from "./tokens.js";

// 権限判定 API
export {
  canAccess,
  hasAllPermissions,
  hasAllRoles,
  hasAnyPermission,
  hasAnyRole,
  hasPermission,
  hasRole,
} from "./permissions.js";

// AuthManager ファクトリ
export { createAuthManager } from "./manager.js";
