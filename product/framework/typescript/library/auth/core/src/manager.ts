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

// FIFO 直列化ミューテックスを生成する
// applySession の `tokenStore.set/clear` と `current` 代入の間に await を挟むことで、
// 並行 signIn / signOut / refresh が起きた際に「メモリと storage が食い違う」事故を防ぐ
function createMutex(): <R>(op: () => Promise<R>) => Promise<R> {
  // 直列実行の連鎖を表す Promise (初期値は即解決)
  let chain: Promise<unknown> = Promise.resolve();
  // op を chain の末尾に繋ぎ、結果 Promise を返す
  return <R>(op: () => Promise<R>): Promise<R> => {
    // 前段の成否に関わらず自分の op を起動する (catch 経路も op に倒す)
    const next = chain.then(op, op);
    // chain は op の例外を吸収して後続を続行させる (前段失敗で後続の起動条件が壊れないようにする)
    // この catch は op rejection 時にのみ呼ばれる; tokenStore set/clear が安定する通常テストでは到達しない
    /* v8 ignore next */
    chain = next.catch(() => undefined);
    // 呼び出し側へは next (op の戻り値そのまま) を返す
    return next;
  };
}

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
  // セッション差し替え (applySession) を直列化するミューテックス
  // 旧実装は tokenStore.set/clear と current 代入の間に await があり、並行
  // signIn/signOut/refresh で「メモリは A、storage は B」のズレが発生していた
  const sessionMutex = createMutex();
  // refresh の singleflight 共有 Promise
  // 並行 refresh 呼び出しで adapter.refresh が多重実行されると、refresh_token を一発で
  // 消費する IdP では 2 回目以降が 401 になり、全並行リクエストが落ちる
  let inflightRefresh: Promise<AuthSession> | null = null;

  // リスナーへセッション変化を通知する
  function emit(event: AuthEvent): void {
    // 現在の購読者へ順に通知する
    for (const listener of listeners) {
      // 各リスナーに現在セッションとイベント名を渡す
      listener(current, event);
    }
  }

  // セッションを内部状態と TokenStore に反映する
  // mutex 越しに直列化することで、tokens の write と current の差し替えが
  // 並行呼び出し間でインターリーブされないことを保証する
  async function applySession(session: AuthSession, event: AuthEvent): Promise<AuthSession> {
    return sessionMutex(async () => {
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
    });
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
  // singleflight: 並行呼び出しは 1 つの adapter.refresh / getSession を共有して
  // refresh_token の二重消費による 401 連鎖を防ぐ
  async function refresh(): Promise<AuthSession> {
    // 既に in-flight なら同じ Promise を共有する (refresh_token を 1 回しか消費させない)
    if (inflightRefresh !== null) return inflightRefresh;
    // 新規 in-flight を組み立てる (IIFE を Promise として捕捉)
    const task = (async (): Promise<AuthSession> => {
      // 現在保存済みのトークンを取得する
      const tokens = await tokenStore.get();
      // adapter.refresh があればトークン更新を使う
      const session = adapter.refresh === undefined ? await adapter.getSession() : await adapter.refresh(tokens);
      // 更新結果を反映して返す
      return await applySession(session, "tokenRefreshed");
    })();
    // 並行呼び出しが共有できるよう保持
    inflightRefresh = task;
    try {
      // task を待って結果を返す
      return await task;
    } finally {
      // 成否に関わらず in-flight 参照を解放する (同一性比較で自分のものだけ消す)
      // 同一性比較は防御コード: 通常は自分が直前に書いた task が末尾のまま残るが、
      // 何らかの理由で別 task に置換された場合に意図せず消さないようにする
      /* v8 ignore next 3 */
      if (inflightRefresh === task) {
        inflightRefresh = null;
      }
    }
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
