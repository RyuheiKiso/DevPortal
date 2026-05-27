// AuthManager 実装に必要な型を取り込み
import type {
  AuthAdapter,
  AuthEvent,
  AuthListener,
  AuthManager,
  AuthManagerOptions,
  AuthSession,
  AuthTokenSet,
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
  // getSnapshot がキャッシュとして返す参照 (#S3) — current と同じ参照で初期化し、applySession で更新する
  // 同一セッション中は同じ参照を返すことで useSyncExternalStore 等の Object.is 比較が安定する
  let cachedSnapshot: AuthSession = current;
  // adapter.getSession 済みかどうかを保持する
  // initialSession が整合している (authenticated × user!=null、または anonymous) ときのみ loaded=true (#S2)
  // 不整合な初期入力 (例: authenticated × user=null) は normalizeSession で anonymous に倒されるが、
  // loaded=true のままだと getSession() が adapter を呼ばず anonymous を返し続けてしまうため、loaded=false にして再取得させる
  let loaded = false;
  if (options.initialSession !== undefined) {
    // 入力側の整合性を判定する (normalize 後では情報が失われるので raw input を見る)
    const input = options.initialSession;
    // 認証済みかつ user が存在するなら整合
    const isConsistentAuth = input.status === "authenticated" && input.user !== null;
    // 匿名なら user の状態に関わらず整合 (normalizeSession で user=null へ倒される設計と一致)
    const isConsistentAnon = input.status === "anonymous";
    if (isConsistentAuth || isConsistentAnon) {
      // 整合入力 → ロード済みとして扱う
      loaded = true;
    } else {
      // 不整合 (例: status=authenticated × user=null) → 警告を出して loaded=false で adapter から再取得させる
      // eslint-disable-next-line no-console
      console.warn(
        "[@k1s0-ts-auth/core] initialSession is inconsistent (status/user mismatch); ignoring and falling back to adapter.getSession()",
      );
    }
  }
  // 購読リスナーを保持する
  const listeners = new Set<AuthListener>();
  // トークン保存先を決定する
  // 内部メモリ store は createMemoryTokenStore(current.tokens) で initialSession.tokens を seed 済み
  const tokenStore = options.tokenStore ?? createMemoryTokenStore(current.tokens);
  // セッション差し替え (applySession) を直列化するミューテックス
  // 旧実装は tokenStore.set/clear と current 代入の間に await があり、並行
  // signIn/signOut/refresh で「メモリは A、storage は B」のズレが発生していた
  const sessionMutex = createMutex();
  // 外部 tokenStore が指定されていて initialSession.tokens があるなら、外部 store にも seed する (#S5)
  // sessionMutex を経由させることで後続 applySession と FIFO 順序を保ち、競合させない
  // 失敗時は警告にとどめ初期化自体は失敗させない (initialSession ベースで current は既に有効、後続フローでリカバリ可能)
  if (options.tokenStore !== undefined && current.tokens !== undefined) {
    // クロージャに固定するためローカル束縛
    const initialTokens = current.tokens;
    // fire-and-forget で seed (createAuthManager の同期 return は維持)
    void sessionMutex(async () => {
      try {
        // 外部 store に初期トークンを書き込む
        await options.tokenStore!.set(initialTokens);
      } catch (err) {
        // 失敗は警告のみ
        // eslint-disable-next-line no-console
        console.warn(
          "[@k1s0-ts-auth/core] failed to seed external tokenStore with initialSession.tokens",
          err,
        );
      }
    });
  }
  // refresh の singleflight 共有 Promise
  // 並行 refresh 呼び出しで adapter.refresh が多重実行されると、refresh_token を一発で
  // 消費する IdP では 2 回目以降が 401 になり、全並行リクエストが落ちる
  let inflightRefresh: Promise<AuthSession> | null = null;

  // リスナーへセッション変化を通知する
  // 1 つのリスナーが throw しても他のリスナーへの通知が止まらないよう、各呼び出しを try/catch で隔離する
  // 例外は options.onListenerError があれば委譲し、無ければ console.error にフォールバックする (完全サイレントは運用事故検出が困難なため避ける)
  function emit(event: AuthEvent): void {
    // 反復前に listeners をスナップショット化 (#C8): mid-emit で subscribe された listener は次回 emit から呼ばれる
    // (Set の for...of は反復中に追加された要素も visit する仕様のため、スナップショット化で防ぐ)
    const snapshotListeners = [...listeners];
    // 現在の購読者へ順に通知する
    for (const listener of snapshotListeners) {
      // リスナーごとに独立した正規化コピーを渡す (#C5): 利用者が session を mutate しても内部 cachedSnapshot / 他 listener には影響しない
      const sessionForListener = normalizeSession(current);
      // 隔離して呼ぶ
      try {
        // 各リスナーに正規化コピーとイベント名を渡し、戻り値も観察する (async listener の rejection を捕捉するため)
        // AuthListener の戻り値型は void だが、async function を渡された場合は実際には Promise<void> が返ってくるため unknown で受ける
        const result: unknown = listener(sessionForListener, event);
        // async listener (Promise を返す) なら rejection も捕捉する (#C7)
        if (result instanceof Promise) {
          // 同期 catch と統合された handleListenerError ヘルパに委譲
          result.catch((asyncError: unknown) => handleListenerError(asyncError, event));
        }
      } catch (error) {
        // 同期 throw のときも統合ヘルパに委譲
        handleListenerError(error, event);
      }
    }
  }

  // listener 例外の通知先を確定するヘルパ (#C4: hook 自身の throw も隔離する)
  function handleListenerError(error: unknown, event: AuthEvent): void {
    // ホスト関数全体を try でラップして hook 自身の throw も飲み込む
    try {
      // 利用者提供フックがあれば委譲する
      if (options.onListenerError !== undefined) {
        // observability コールバックへエラー情報を渡す
        options.onListenerError(error, event);
      } else {
        // フック未指定時は console.error でサイレント握り潰しを避ける
        // eslint-disable-next-line no-console
        console.error("[@k1s0-ts-auth/core] auth listener threw", error);
      }
    } catch (hookError) {
      // hook 自身が throw した場合は二重 throw を防ぐためここで隔離 (#C4)
      // 原因エラーも一緒にログして調査の手がかりを残す
      // eslint-disable-next-line no-console
      console.error(
        "[@k1s0-ts-auth/core] onListenerError hook itself threw",
        hookError,
        "(original error:",
        error,
        ")",
      );
    }
  }

  // セッションを内部状態と TokenStore に反映する
  // mutex 越しに直列化することで並行呼び出し間でインターリーブされないことを保証する
  // 順序は `store I/O → current 代入 → emit` とする (#C3)
  // - store I/O 進行中は current は旧セッションのまま (古いトークン/anonymous) で観測される
  // - store I/O が reject した場合は current が差し替わらないため、current/store の不整合が起きない (#C9 自動解消)
  // - emit は store/current の両方が新値で確定した後に呼ばれるので、listener 内で getAccessToken 等を呼んでも整合する
  async function applySession(session: AuthSession, event: AuthEvent): Promise<AuthSession> {
    return sessionMutex(async () => {
      // セッションを正規化して独立コピーにする (この時点ではまだ current に代入しない)
      const normalized = normalizeSession(session);
      // store I/O を先に確定させる (失敗時は current を更新せずに throw する)
      if (normalized.tokens !== undefined) {
        // トークン集合を保存する
        await tokenStore.set(normalized.tokens);
      } else {
        // トークンがない場合は保存済み値を削除する
        await tokenStore.clear();
      }
      // store 確定後に current を新セッションへ差し替える
      current = normalized;
      // getSnapshot のキャッシュも同じ参照で更新 (#S3 同一セッション中は安定参照)
      cachedSnapshot = normalized;
      // getSession 済みとして扱う
      loaded = true;
      // 購読者へ通知する (current/store ともに新値で整合した状態で通知)
      emit(event);
      // 正規化済みセッションを返す
      return current;
    });
  }

  // 現在の同期スナップショットを返す
  // 同一セッション中は同じ参照を返すため useSyncExternalStore で安全に使える (#S3)
  function getSnapshot(): AuthSession {
    // applySession で生成済みのキャッシュ参照を返す (毎回 normalize しない)
    return cachedSnapshot;
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
  // applySession は `store I/O → current 代入 → emit` の順に直列実行されるため、store I/O 完了後にのみ current が新セッションへ差し替わる
  // current.tokens を権威ソースとし、accessToken が未定義のときは store にフォールバックする
  // (SSR ハイドレーション直前、または refreshToken-only セッション直後など、まだ accessToken が確定していないケース用)
  async function getAccessToken(): Promise<string | undefined> {
    // current.tokens.accessToken が定義済みなら current を権威ソースとして返す (空文字 "" もそのまま返す = 利用者が明示した無効トークン)
    // tokens オブジェクト自体は定義済みだが accessToken が undefined (例: refreshToken のみ) のときは store にフォールバックする
    if (current.tokens?.accessToken !== undefined) return current.tokens.accessToken;
    // current.tokens もしくは accessToken が無い場合のみ TokenStore に問い合わせる
    const tokens = await tokenStore.get();
    // store にもなければ undefined
    return tokens?.accessToken;
  }

  // HTTP クライアントに渡せる認証ヘッダを返す
  // 上記 getAccessToken と同じ理由でセッション上のトークンを優先する
  async function getAuthHeaders(): Promise<Record<string, string>> {
    // current.tokens.accessToken の有無で分岐 (`??` ではなく明示的な if/else で書くことで v8 coverage の分岐検出を確実にする)
    let tokens: AuthTokenSet | undefined;
    // current 側に有効な accessToken があれば権威ソースとして採用する
    if (current.tokens?.accessToken !== undefined) {
      // セッション上のトークンを採用 (createAuthorizationHeader は空文字を無効化するため空文字は空ヘッダになる)
      tokens = current.tokens;
    } else {
      // current が accessToken を持たないときのみ store にフォールバック (refreshToken-only セッション / SSR ハイドレーション直前など)
      tokens = await tokenStore.get();
    }
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
