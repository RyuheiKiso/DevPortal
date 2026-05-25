// AuthManager 実装に必要な型を取り込み
import type {
  AuthAdapter,
  AuthEvent,
  AuthListener,
  AuthManager,
  AuthManagerOptions,
  AuthSession,
  GetSessionOptions,
  SignInRequest,
  SignOutRequest,
} from "./types.js";
// 権限判定ヘルパを取り込み
import { canAccess, hasPermission, hasRole } from "./permissions.js";
// セッション正規化ヘルパを取り込み
import { createAnonymousSession, normalizeSession } from "./session.js";
// トークン保存とヘッダ生成のヘルパを取り込み
import { createAuthorizationHeader, createMemoryTokenStore } from "./tokens.js";

// AuthManager を作成する
export function createAuthManager(
  // バックエンドや IdP との接続を担うアダプタ
  adapter: AuthAdapter,
  // 初期セッションや TokenStore の任意設定
  options: AuthManagerOptions = {},
): AuthManager {
  // 現在のセッションスナップショットを保持する
  let current = normalizeSession(options.initialSession);
  // adapter.getSession 済みかどうかを保持する
  let loaded = options.initialSession !== undefined;
  // 購読リスナーを保持する
  const listeners = new Set<AuthListener>();
  // トークン保存先を決定する
  const tokenStore = options.tokenStore ?? createMemoryTokenStore(current.tokens);

  // リスナーへセッション変化を通知する
  function emit(event: AuthEvent): void {
    // 現在の購読者へ順に通知する
    for (const listener of listeners) {
      // 各リスナーに現在セッションとイベント名を渡す
      listener(current, event);
    }
  }

  // セッションを内部状態と TokenStore に反映する
  async function applySession(session: AuthSession, event: AuthEvent): Promise<AuthSession> {
    // セッションを正規化して保持する
    current = normalizeSession(session);
    // 認証済みかつトークンありなら TokenStore に保存する
    if (current.tokens !== undefined) {
      // トークン集合を保存する
      await tokenStore.set(current.tokens);
    } else {
      // トークンがない場合は保存済み値を削除する
      await tokenStore.clear();
    }
    // getSession 済みとして扱う
    loaded = true;
    // 購読者へ通知する
    emit(event);
    // 正規化済みセッションを返す
    return current;
  }

  // 現在の同期スナップショットを返す
  function getSnapshot(): AuthSession {
    // 外部 mutation を避けるため正規化コピーを返す
    return normalizeSession(current);
  }

  // セッションを取得する
  async function getSession(optionsForGet: GetSessionOptions = {}): Promise<AuthSession> {
    // refresh 指定または未ロードの場合は adapter から取得する
    if (optionsForGet.refresh === true || !loaded) {
      // adapter 経由で最新セッションを取得する
      const session = await adapter.getSession();
      // 取得結果を反映して返す
      return await applySession(session, "sessionChanged");
    }
    // 現在のスナップショットを返す
    return getSnapshot();
  }

  // セッションを明示的に差し替える
  async function setSession(
    // 反映するセッション
    session: AuthSession,
    // 通知イベント名
    event: AuthEvent = "sessionChanged",
  ): Promise<AuthSession> {
    // 内部状態に反映して返す
    return await applySession(session, event);
  }

  // ログイン処理を実行する
  async function signIn(request?: SignInRequest): Promise<AuthSession> {
    // adapter が signIn を持つ場合はそれを使う
    const session = adapter.signIn === undefined ? await adapter.getSession() : await adapter.signIn(request);
    // ログイン結果を反映して返す
    return await applySession(session, "signedIn");
  }

  // ログアウト処理を実行する
  async function signOut(request?: SignOutRequest): Promise<void> {
    // adapter が signOut を持つ場合は先に実行する
    if (adapter.signOut !== undefined) {
      // バックエンド側または IdP 側のログアウトを実行する
      await adapter.signOut(request);
    }
    // 匿名セッションを反映する
    await applySession(createAnonymousSession(), "signedOut");
  }

  // トークンまたはセッションを更新する
  async function refresh(): Promise<AuthSession> {
    // 現在保存済みのトークンを取得する
    const tokens = await tokenStore.get();
    // adapter.refresh があればトークン更新を使う
    const session = adapter.refresh === undefined ? await adapter.getSession() : await adapter.refresh(tokens);
    // 更新結果を反映して返す
    return await applySession(session, "tokenRefreshed");
  }

  // 現在のアクセストークンを返す
  async function getAccessToken(): Promise<string | undefined> {
    // TokenStore の値を優先する
    const tokens = await tokenStore.get();
    // 保存済みアクセストークンがあれば返す
    if (tokens?.accessToken !== undefined) return tokens.accessToken;
    // セッション上のアクセストークンを返す
    return current.tokens?.accessToken;
  }

  // HTTP クライアントに渡せる認証ヘッダを返す
  async function getAuthHeaders(): Promise<Record<string, string>> {
    // TokenStore の値を取得する
    const tokens = (await tokenStore.get()) ?? current.tokens;
    // Authorization ヘッダ値を生成する
    const authorization = createAuthorizationHeader(tokens);
    // トークンがなければ空ヘッダを返す
    if (authorization === undefined) return {};
    // Authorization ヘッダを返す
    return { Authorization: authorization };
  }

  // ロールを持つか判定する
  function hasRoleInCurrentSession(role: string): boolean {
    // 現在ユーザーに委譲して判定する
    return hasRole(current.user, role);
  }

  // 権限を持つか判定する
  function hasPermissionInCurrentSession(permission: string): boolean {
    // 現在ユーザーに委譲して判定する
    return hasPermission(current.user, permission);
  }

  // セッション変化を購読する
  function subscribe(listener: AuthListener): () => void {
    // リスナーを追加する
    listeners.add(listener);
    // 購読解除関数を返す
    return () => {
      // リスナーを削除する
      listeners.delete(listener);
    };
  }

  // AuthManager 契約を返す
  return {
    // 現在スナップショット
    getSnapshot,
    // セッション取得
    getSession,
    // セッション設定
    setSession,
    // ログイン
    signIn,
    // ログアウト
    signOut,
    // 更新
    refresh,
    // トークン取得
    getAccessToken,
    // 認証ヘッダ取得
    getAuthHeaders,
    // ロール判定
    hasRole: hasRoleInCurrentSession,
    // 権限判定
    hasPermission: hasPermissionInCurrentSession,
    // 複合判定
    canAccess: (requirement) => canAccess(current, requirement),
    // 購読
    subscribe,
  };
}
