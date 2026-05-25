// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象を取り込み
import { createAuthManager } from "./manager.js";
// 型を取り込み
import type { AuthAdapter, AuthSession, TokenStore } from "./types.js";

// 認証済みセッションを作る
function createSession(accessToken = "token-1"): AuthSession {
  // 認証済みセッションを返す
  return {
    // 認証済み状態
    status: "authenticated",
    // ユーザー情報
    user: {
      // ユーザー ID
      id: "user-1",
      // ロール一覧
      roles: ["admin"],
      // 権限一覧
      permissions: ["invoice:read"],
    },
    // トークン集合
    tokens: { accessToken },
  };
}

// AuthManager のテスト
describe("createAuthManager", () => {
  // adapter.getSession で初期ロードできること
  it("adapter からセッションをロードする", async () => {
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager を作る
    const manager = createAuthManager(adapter);
    // セッションを取得する
    const session = await manager.getSession();
    // 認証済みになること
    expect(session.status).toBe("authenticated");
    // adapter が呼ばれること
    expect(adapter.getSession).toHaveBeenCalledTimes(1);
    // 2 回目はキャッシュされること
    await manager.getSession();
    // adapter が追加で呼ばれないこと
    expect(adapter.getSession).toHaveBeenCalledTimes(1);
  });

  // refresh:true 指定で adapter を再取得すること
  it("getSession({ refresh: true }) でキャッシュを破棄して adapter を再呼び出しする", async () => {
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager を作る
    const manager = createAuthManager(adapter);
    // 初回読み込み
    await manager.getSession();
    // refresh 指定で再取得
    await manager.getSession({ refresh: true });
    // 2 回呼ばれること
    expect(adapter.getSession).toHaveBeenCalledTimes(2);
  });

  // 初期セッションを options で渡せること
  it("initialSession を options で受け取ると adapter を呼ばずに使える", async () => {
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // 初期セッションを与えて manager を作る
    const manager = createAuthManager(adapter, { initialSession: createSession("seeded") });
    // getSession しても adapter は呼ばれないこと
    const session = await manager.getSession();
    // 初期セッション由来のトークンが反映されていること
    expect(session.tokens?.accessToken).toBe("seeded");
    // adapter は未呼び出し
    expect(adapter.getSession).not.toHaveBeenCalled();
  });

  // ロード前の getSnapshot は匿名であること
  it("ロード前は getSnapshot で匿名セッションを返す", () => {
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager を作る
    const manager = createAuthManager(adapter);
    // スナップショットを取得
    const snapshot = manager.getSnapshot();
    // 匿名であること
    expect(snapshot.status).toBe("anonymous");
    // user は null
    expect(snapshot.user).toBeNull();
  });

  // signIn / refresh / signOut が状態を更新すること
  it("signIn / refresh / signOut で状態を更新する", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // 現在セッション取得
      getSession: vi.fn(async () => ({ status: "anonymous", user: null })),
      // ログイン
      signIn: vi.fn(async () => createSession("signed-in")),
      // 更新
      refresh: vi.fn(async () => createSession("refreshed")),
      // ログアウト
      signOut: vi.fn(async () => undefined),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // イベント記録を用意する
    const events: string[] = [];
    // 購読する
    manager.subscribe((_session, event) => events.push(event));
    // ログインする
    await manager.signIn();
    // ログイン後トークンがヘッダに出ること
    expect(await manager.getAuthHeaders()).toEqual({ Authorization: "Bearer signed-in" });
    // 更新する
    await manager.refresh();
    // 更新後トークンがヘッダに出ること
    expect(await manager.getAccessToken()).toBe("refreshed");
    // ログアウトする
    await manager.signOut();
    // ログアウト後は匿名であること
    expect(manager.getSnapshot().status).toBe("anonymous");
    // イベント順が正しいこと
    expect(events).toEqual(["signedIn", "tokenRefreshed", "signedOut"]);
  });

  // signIn 引数を adapter に渡すこと
  it("signIn の引数を adapter.signIn に転送する", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // 現在セッション取得
      getSession: vi.fn(async () => createSession()),
      // ログイン
      signIn: vi.fn(async () => createSession("signed-in")),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // 任意の引数で signIn する
    await manager.signIn({ redirectUrl: "/after-login" });
    // 引数が渡っていること
    expect(adapter.signIn).toHaveBeenCalledWith({ redirectUrl: "/after-login" });
  });

  // adapter.signIn が無いときは getSession にフォールバックすること
  it("adapter.signIn が未定義のときは getSession にフォールバックする", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // 現在セッション取得（signIn の代用）
      getSession: vi.fn(async () => createSession("getsession-fallback")),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // signIn する
    const session = await manager.signIn();
    // getSession 由来のトークンが反映されていること
    expect(session.tokens?.accessToken).toBe("getsession-fallback");
    // adapter.getSession が呼ばれていること
    expect(adapter.getSession).toHaveBeenCalled();
  });

  // adapter.refresh が無いときは getSession にフォールバックすること
  it("adapter.refresh が未定義のときは getSession にフォールバックする", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // 現在セッション取得（refresh の代用）
      getSession: vi.fn(async () => createSession("getsession-refresh")),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // refresh する
    const session = await manager.refresh();
    // getSession 由来のトークンが反映されていること
    expect(session.tokens?.accessToken).toBe("getsession-refresh");
  });

  // adapter.signOut が無いときでも匿名へ反映されること
  it("adapter.signOut が未定義でも匿名セッションへ反映する", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // 現在セッション取得（signOut は持たない）
      getSession: vi.fn(async () => createSession()),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // 一度ロードしておく
    await manager.getSession();
    // signOut する
    await manager.signOut();
    // 匿名へ落ちていること
    expect(manager.getSnapshot().status).toBe("anonymous");
  });

  // setSession でイベント名を指定できること
  it("setSession の event 引数を尊重する（既定は sessionChanged）", async () => {
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager を作る
    const manager = createAuthManager(adapter);
    // 受信イベントを記録
    const events: string[] = [];
    // 購読する
    manager.subscribe((_session, event) => events.push(event));
    // 既定イベントで差し替え
    await manager.setSession(createSession("set-default"));
    // 明示イベントで差し替え
    await manager.setSession(createSession("set-token-refresh"), "tokenRefreshed");
    // 期待順に並ぶこと
    expect(events).toEqual(["sessionChanged", "tokenRefreshed"]);
  });

  // tokens を持たないセッションを反映すると TokenStore.clear が呼ばれること
  it("tokens を持たないセッションでは TokenStore.clear が呼ばれる", async () => {
    // 外部 TokenStore を作る
    const store: TokenStore = {
      // get モック
      get: vi.fn(async () => undefined),
      // set モック
      set: vi.fn(async () => undefined),
      // clear モック
      clear: vi.fn(async () => undefined),
    };
    // adapter を作る
    const adapter: AuthAdapter = {
      // tokens を持たない anonymous を返す
      getSession: vi.fn(async () => ({ status: "anonymous", user: null })),
    };
    // 外部 store を渡して manager を作る
    const manager = createAuthManager(adapter, { tokenStore: store });
    // ロードする
    await manager.getSession();
    // clear が呼ばれていること
    expect(store.clear).toHaveBeenCalled();
    // set は呼ばれていないこと
    expect(store.set).not.toHaveBeenCalled();
  });

  // tokens を持つセッションを反映すると TokenStore.set が呼ばれること
  it("tokens を持つセッションでは TokenStore.set が呼ばれる", async () => {
    // 外部 TokenStore を作る
    const store: TokenStore = {
      // get モック
      get: vi.fn(async () => undefined),
      // set モック
      set: vi.fn(async () => undefined),
      // clear モック
      clear: vi.fn(async () => undefined),
    };
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession("xyz")) };
    // 外部 store を渡して manager を作る
    const manager = createAuthManager(adapter, { tokenStore: store });
    // ロードする
    await manager.getSession();
    // set が想定値で呼ばれていること
    expect(store.set).toHaveBeenCalledWith({ accessToken: "xyz" });
  });

  // getAccessToken は TokenStore を優先しつつ、未保存時はセッションから取得すること
  it("getAccessToken は TokenStore 優先、未保存時はセッションのトークンを返す", async () => {
    // TokenStore は空
    const store: TokenStore = {
      // 常に undefined
      get: vi.fn(async () => undefined),
      // 何もしない
      set: vi.fn(async () => undefined),
      // 何もしない
      clear: vi.fn(async () => undefined),
    };
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession("from-session")) };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // ロード
    await manager.getSession();
    // セッション側のトークンへフォールバックすること
    expect(await manager.getAccessToken()).toBe("from-session");
  });

  // getAccessToken は TokenStore に保存されている値を優先すること
  it("getAccessToken は TokenStore に値があればそちらを返す", async () => {
    // store には別の値を持たせる
    const store: TokenStore = {
      // 保存値を返す
      get: vi.fn(async () => ({ accessToken: "from-store" })),
      // 受け取りだけ
      set: vi.fn(async () => undefined),
      // 受け取りだけ
      clear: vi.fn(async () => undefined),
    };
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession("from-session")) };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // ロード
    await manager.getSession();
    // TokenStore の値が優先されること
    expect(await manager.getAccessToken()).toBe("from-store");
  });

  // getAuthHeaders は authorization 不在時に空オブジェクトを返すこと
  it("getAuthHeaders はトークンが無いとき空オブジェクトを返す", async () => {
    // 匿名で tokens 無し
    const adapter: AuthAdapter = {
      // tokens 未提供
      getSession: vi.fn(async () => ({ status: "anonymous", user: null })),
    };
    // manager
    const manager = createAuthManager(adapter);
    // ロード
    await manager.getSession();
    // 空ヘッダ
    expect(await manager.getAuthHeaders()).toEqual({});
  });

  // 権限判定を現在セッションに対して行うこと
  it("現在セッションに対してロールと権限を判定する", async () => {
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager を作る
    const manager = createAuthManager(adapter);
    // ロードする
    await manager.getSession();
    // admin ロールを持つこと
    expect(manager.hasRole("admin")).toBe(true);
    // invoice:read 権限を持つこと
    expect(manager.hasPermission("invoice:read")).toBe(true);
    // 複合要件を満たすこと
    expect(manager.canAccess({ roles: ["admin"], permissions: ["invoice:read"] }).allowed).toBe(true);
  });

  // subscribe は購読解除関数を返すこと
  it("subscribe は購読解除関数を返し、解除後は通知されない", async () => {
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager を作る
    const manager = createAuthManager(adapter);
    // リスナー記録
    const calls: string[] = [];
    // 購読する
    const unsubscribe = manager.subscribe((_session, event) => calls.push(event));
    // 状態変化を発生させる
    await manager.getSession();
    // 1 回通知が来ていること
    expect(calls).toHaveLength(1);
    // 購読解除
    unsubscribe();
    // もう一度状態変化を起こす
    await manager.getSession({ refresh: true });
    // 通知件数は増えないこと
    expect(calls).toHaveLength(1);
  });

  // signOut の引数を adapter.signOut に転送すること
  it("signOut の引数を adapter.signOut に転送する", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // 認証済みを返す
      getSession: vi.fn(async () => createSession()),
      // signOut モック
      signOut: vi.fn(async () => undefined),
    };
    // manager
    const manager = createAuthManager(adapter);
    // ロードしておく
    await manager.getSession();
    // 引数付きで signOut
    await manager.signOut({ revokeServerSession: true });
    // adapter に引数が渡ること
    expect(adapter.signOut).toHaveBeenCalledWith({ revokeServerSession: true });
  });

  // refresh は TokenStore の値を adapter.refresh に渡すこと
  it("refresh は TokenStore の現在値を adapter.refresh に渡す", async () => {
    // store は固定値を返す
    const store: TokenStore = {
      // 固定トークンを返す
      get: vi.fn(async () => ({ accessToken: "stored", refreshToken: "r" })),
      // 受け取りだけ
      set: vi.fn(async () => undefined),
      // 受け取りだけ
      clear: vi.fn(async () => undefined),
    };
    // adapter
    const adapter: AuthAdapter = {
      // 現在セッション
      getSession: vi.fn(async () => createSession()),
      // refresh モック
      refresh: vi.fn(async () => createSession("refreshed")),
    };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // refresh する
    await manager.refresh();
    // 引数が転送されていること
    expect(adapter.refresh).toHaveBeenCalledWith({ accessToken: "stored", refreshToken: "r" });
  });
});
