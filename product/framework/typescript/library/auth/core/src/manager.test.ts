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

  // getAccessToken は current.tokens を権威ソースとし、定義済みなら store には問い合わせないこと
  it("getAccessToken は current.tokens を返し、store には問い合わせない (current 優先)", async () => {
    // store は呼ばれてはいけない
    const store: TokenStore = {
      // 呼ばれたら検出できるよう spy
      get: vi.fn(async () => undefined),
      // 受け取りだけ
      set: vi.fn(async () => undefined),
      // 受け取りだけ
      clear: vi.fn(async () => undefined),
    };
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession("from-session")) };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // ロード (この時点で current.tokens は from-session)
    await manager.getSession();
    // store.get の呼び出し回数をリセットする (applySession 内で store の操作はあるが、ここでは getAccessToken の挙動だけ見たい)
    (store.get as ReturnType<typeof vi.fn>).mockClear();
    // current 由来のトークンが返ること
    expect(await manager.getAccessToken()).toBe("from-session");
    // 競合修正の回帰防止: current.tokens が定義済みなら store.get は呼ばれない
    expect(store.get).not.toHaveBeenCalled();
  });

  // getAccessToken は store の古い値より current.tokens を優先すること (#2 競合修正の回帰防止)
  it("getAccessToken は current.tokens を優先し、store の古い値は使わない", async () => {
    // store には古いトークンが残っているシナリオ
    const store: TokenStore = {
      // 古い保存値を返す
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
    // ロード (current.tokens は from-session、store も applySession で from-session に上書きされる)
    await manager.getSession();
    // current 由来のトークンが返ること (修正前は store の "from-store" を返していた)
    expect(await manager.getAccessToken()).toBe("from-session");
  });

  // getAuthHeaders も current.tokens が未定義の場合に store フォールバックすること
  it("getAuthHeaders は current.tokens が未定義の場合に store フォールバックでヘッダを組み立てる", async () => {
    // store には有効トークンを持たせる
    const store: TokenStore = {
      // 保存値を返す
      get: vi.fn(async () => ({ accessToken: "from-store" })),
      // 受け取りだけ
      set: vi.fn(async () => undefined),
      // 受け取りだけ
      clear: vi.fn(async () => undefined),
    };
    // adapter は anonymous (current.tokens は undefined のまま)
    const adapter: AuthAdapter = {
      // 匿名セッション
      getSession: vi.fn(async () => ({ status: "anonymous" as const, user: null })),
    };
    // manager (initialSession 未指定なので loaded=false、current.tokens は undefined)
    const manager = createAuthManager(adapter, { tokenStore: store });
    // store のヘッダが組み立てられること (current フォールバック経路)
    expect(await manager.getAuthHeaders()).toEqual({ Authorization: "Bearer from-store" });
  });

  // current.tokens が未定義の場合のみ store にフォールバックすること (SSR / 初期化前の経路)
  it("current.tokens が未定義の場合のみ store にフォールバックする", async () => {
    // store は値を持つ
    const store: TokenStore = {
      // 保存値を返す
      get: vi.fn(async () => ({ accessToken: "from-store" })),
      // 受け取りだけ
      set: vi.fn(async () => undefined),
      // 受け取りだけ
      clear: vi.fn(async () => undefined),
    };
    // adapter は tokens を持たない anonymous を返す
    const adapter: AuthAdapter = {
      // 匿名セッション (current.tokens は undefined)
      getSession: vi.fn(async () => ({ status: "anonymous" as const, user: null })),
    };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // ロード (current.tokens は undefined、store は applySession で clear されるはず)
    await manager.getSession();
    // applySession の clear で store も空になっているため、改めて値を持たせ直す
    (store.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ accessToken: "from-store" });
    // current.tokens が undefined なので store フォールバックされる
    expect(await manager.getAccessToken()).toBe("from-store");
  });

  // current.tokens は定義済みだが accessToken=undefined のとき store にフォールバックすること (#C1, #S8)
  // refreshToken のみを持つ過渡セッション (refresh フロー直後など) で store の有効 accessToken を漏らさず使うため
  it("getAccessToken は current.tokens.accessToken=undefined のとき store にフォールバックする (#C1, #S8)", async () => {
    // store には独立した値を持たせ続ける (mock の set は no-op で内部状態を変えない)
    const store: TokenStore = {
      // 常に store 由来の値を返す
      get: vi.fn(async () => ({ accessToken: "from-store" })),
      // 受け取りだけ (内部状態は変更しない)
      set: vi.fn(async () => undefined),
      // 受け取りだけ
      clear: vi.fn(async () => undefined),
    };
    // adapter は今回使わない経路
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // setSession で current.tokens に refreshToken だけ持つセッションを反映
    await manager.setSession({
      // 認証済み状態
      status: "authenticated",
      // 最小ユーザー
      user: { id: "user-1", roles: [], permissions: [] },
      // accessToken なし、refreshToken のみ
      tokens: { refreshToken: "rt" },
    });
    // current.tokens.accessToken は undefined なので store にフォールバックして "from-store" が返ること
    expect(await manager.getAccessToken()).toBe("from-store");
  });

  // current.tokens は定義済みだが accessToken=undefined のとき getAuthHeaders も store フォールバックすること (#C2, #S8)
  it("getAuthHeaders は current.tokens.accessToken=undefined のとき store にフォールバックする (#C2, #S8)", async () => {
    // store には独立した accessToken を持たせる
    const store: TokenStore = {
      // 常に有効 accessToken + tokenType を返す
      get: vi.fn(async () => ({ accessToken: "from-store", tokenType: "DPoP" })),
      // 受け取りだけ
      set: vi.fn(async () => undefined),
      // 受け取りだけ
      clear: vi.fn(async () => undefined),
    };
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // setSession で current.tokens に refreshToken だけ持つセッションを反映
    await manager.setSession({
      // 認証済み状態
      status: "authenticated",
      // 最小ユーザー
      user: { id: "user-1", roles: [], permissions: [] },
      // accessToken なし、refreshToken のみ
      tokens: { refreshToken: "rt" },
    });
    // current.tokens.accessToken は undefined なので store の値で Authorization ヘッダが組み立てられること
    expect(await manager.getAuthHeaders()).toEqual({ Authorization: "DPoP from-store" });
  });

  // current.tokens.accessToken が空文字なら store にフォールバックせず空文字を返すこと (#2 空文字仕様)
  it("current.tokens.accessToken が空文字でも store フォールバックせず空文字を返す", async () => {
    // store には別の値を持たせる (フォールバックされたら値が返ってしまう)
    const store: TokenStore = {
      // 古い保存値
      get: vi.fn(async () => ({ accessToken: "from-store" })),
      // 受け取りだけ
      set: vi.fn(async () => undefined),
      // 受け取りだけ
      clear: vi.fn(async () => undefined),
    };
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // setSession で current.tokens.accessToken を空文字に明示する
    await manager.setSession({
      // 認証済み状態
      status: "authenticated",
      // 最小ユーザー
      user: { id: "user-1", roles: [], permissions: [] },
      // 空文字 accessToken
      tokens: { accessToken: "" },
    });
    // 空文字は「セッションが明示的に無効トークンを表現している」状態として、そのまま返す
    expect(await manager.getAccessToken()).toBe("");
    // getAuthHeaders 側も createAuthorizationHeader の空文字無効化ロジックにより空オブジェクトを返す
    expect(await manager.getAuthHeaders()).toEqual({});
  });

  // applySession 進行中 (store.set pending) の並行 getAccessToken は旧 (anonymous) のまま (#C3 新仕様)
  // applySession は `store I/O → current 代入 → emit` の順なので、store.set 完了前は current が旧のまま
  it("signIn 進行中 (store.set pending) の並行 getAccessToken は旧 (anonymous) のまま", async () => {
    // store.set を外部から resolve できるゲートで遅延させ、競合窓を再現する
    let releaseStoreSet: (() => void) | undefined;
    // store.set が pending の間ずっと止まる Promise
    const storeSetGate = new Promise<void>((resolve) => {
      // resolve を外に取り出す
      releaseStoreSet = resolve;
    });
    // store 実装 (初期は空、set はゲートが開くまで pending)
    const store: TokenStore = {
      // 未保存 (initialSession なし、まだ何も書き込んでいない)
      get: vi.fn(async () => undefined),
      // set はゲートが開くまで決して解決しない
      set: vi.fn(async () => {
        // 外部から resolve されるまで待つ
        await storeSetGate;
      }),
      // clear は今回のテスト経路では呼ばれない
      clear: vi.fn(async () => undefined),
    };
    // adapter (今回は setSession 経路を使うため未使用)
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // setSession を await せずに発火 (applySession 内で store.set は pending、current はまだ旧 anonymous)
    const setSessionPromise = manager.setSession({
      // 認証済み状態
      status: "authenticated",
      // 最小ユーザー
      user: { id: "user-1", roles: [], permissions: [] },
      // 新トークン
      tokens: { accessToken: "new-access" },
    });
    // sessionMutex の chain.then(op, op) と applySession 内の op() でマイクロタスクを進める
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 新順序により current.tokens はまだ undefined のまま、store もまだ書かれていない
    // 修正前 (current 先行更新) は "new-access" が返っていたが、新仕様では undefined が正解
    expect(await manager.getAccessToken()).toBeUndefined();
    // ヘッダ取得も空オブジェクト (current.tokens 未定義 + store 未保存)
    expect(await manager.getAuthHeaders()).toEqual({});
    // ゲートを開いて applySession を完走させる
    releaseStoreSet?.();
    // setSession の完了を待つ (リーク防止)
    await setSessionPromise;
    // 完了後は current.tokens が new-access に差し替わっていること
    expect(await manager.getAccessToken()).toBe("new-access");
  });

  // signOut 進行中 (store.clear pending) の並行 getAccessToken は旧 access token を返す (#C3)
  // 新順序により store.clear 完了前は current が旧 (signedIn) のまま観測される
  it("signOut 進行中 (store.clear pending) の並行 getAccessToken は旧 access token を返す", async () => {
    // store.clear を外部から resolve できるゲートで遅延させる
    let releaseStoreClear: (() => void) | undefined;
    // store.clear が pending の間ずっと止まる Promise
    const storeClearGate = new Promise<void>((resolve) => {
      // resolve を外に取り出す
      releaseStoreClear = resolve;
    });
    // store 実装 (set は通常完走、clear だけゲート遅延)
    const store: TokenStore = {
      // get は未使用経路
      get: vi.fn(async () => undefined),
      // set は即解決 (signIn 経路で使用)
      set: vi.fn(async () => undefined),
      // clear はゲートが開くまで pending (signOut 経路で使用)
      clear: vi.fn(async () => {
        // 外部から resolve されるまで待つ
        await storeClearGate;
      }),
    };
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // 先に signIn を完了して current に旧 access token を入れる
    await manager.setSession({
      // 認証済み状態
      status: "authenticated",
      // 最小ユーザー
      user: { id: "user-1", roles: [], permissions: [] },
      // 旧トークン
      tokens: { accessToken: "token-old" },
    });
    // この時点で current.tokens.accessToken === "token-old"
    expect(await manager.getAccessToken()).toBe("token-old");
    // signOut を await せず発火 (applySession 内で store.clear は pending、current はまだ旧 signedIn)
    const signOutPromise = manager.signOut();
    // マイクロタスクを進めて applySession の store.clear に到達させる
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 新順序により current.tokens はまだ token-old のまま、store.clear は pending
    // 修正前 (current 先行更新) は anonymous → store フォールバックで undefined だったが、新仕様では旧トークンが返る
    expect(await manager.getAccessToken()).toBe("token-old");
    // ヘッダも旧トークンで組み立てられる (signOut 完了前は旧セッションがそのまま使用可能)
    expect(await manager.getAuthHeaders()).toEqual({ Authorization: "Bearer token-old" });
    // ゲートを開いて applySession を完走させる
    releaseStoreClear?.();
    // signOut の完了を待つ
    await signOutPromise;
    // 完了後は current=anonymous, store=clear で getAccessToken は undefined
    expect(await manager.getAccessToken()).toBeUndefined();
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

  // refresh の singleflight: 10 並列呼び出しで adapter.refresh は 1 回しか呼ばれない
  // (refresh_token を一発で消費する IdP では二重実行で 2 回目以降が 401 になるため重要)
  it("並列 refresh 呼び出しでも adapter.refresh は 1 度しか実行されない (singleflight)", async () => {
    // adapter.refresh が解決するまで一定遅延するモック
    let refreshCalls = 0;
    const adapter: AuthAdapter = {
      getSession: vi.fn(async () => createSession()),
      refresh: vi.fn(async () => {
        refreshCalls += 1;
        // マイクロタスクを跨ぐため Promise.resolve を 1 つ挟む
        await Promise.resolve();
        return createSession("refreshed");
      }),
    };
    const manager = createAuthManager(adapter);
    // 10 並列で refresh を発火する
    const results = await Promise.all(
      Array.from({ length: 10 }, () => manager.refresh()),
    );
    // adapter.refresh は singleflight で 1 回のみ
    expect(refreshCalls).toBe(1);
    expect(adapter.refresh).toHaveBeenCalledTimes(1);
    // 全結果が同じ refreshed セッションを返す
    for (const r of results) {
      expect(r.user?.id).toBe("user-1");
    }
  });

  // refresh の singleflight: 解決後は in-flight 参照が解放され、次回呼び出しが新規実行される
  it("refresh 完了後は in-flight が解放され、次回呼び出しは新規 adapter.refresh を起動する", async () => {
    let refreshCalls = 0;
    const adapter: AuthAdapter = {
      getSession: vi.fn(async () => createSession()),
      refresh: vi.fn(async () => {
        refreshCalls += 1;
        return createSession("refreshed");
      }),
    };
    const manager = createAuthManager(adapter);
    // 1 回目
    await manager.refresh();
    // 2 回目 (in-flight は既に null に戻っているはず)
    await manager.refresh();
    expect(refreshCalls).toBe(2);
  });

  // listener の例外が他 listener への通知を止めないこと
  it("1 つの listener が throw しても他の listener には通知が届く (onListenerError 経路)", async () => {
    // observability フックを spy する
    const onListenerError = vi.fn();
    // adapter を作る
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // onListenerError を渡して manager を作る
    const manager = createAuthManager(adapter, { onListenerError });
    // throw する listener A
    const listenerA = vi.fn(() => {
      // 任意の例外を投げる
      throw new Error("boom");
    });
    // 通常の listener B
    const listenerB = vi.fn();
    // 順番依存を避けるため両方登録する
    manager.subscribe(listenerA);
    manager.subscribe(listenerB);
    // セッション差し替えで emit を発火する
    await manager.setSession(createSession());
    // B は A の例外に関わらず 1 回呼ばれていること
    expect(listenerB).toHaveBeenCalledTimes(1);
    // B のイベント名は sessionChanged
    expect(listenerB).toHaveBeenCalledWith(expect.anything(), "sessionChanged");
    // onListenerError は A の例外を捕捉して 1 回呼ばれていること
    expect(onListenerError).toHaveBeenCalledTimes(1);
    // 受け取ったエラーは "boom"
    expect((onListenerError.mock.calls[0]?.[0] as Error).message).toBe("boom");
    // 第 2 引数は emit 時のイベント名
    expect(onListenerError.mock.calls[0]?.[1]).toBe("sessionChanged");
  });

  // onListenerError 未指定時は console.error にフォールバックすること
  it("onListenerError 未指定時は console.error でリスナー例外を通知する", async () => {
    // console.error を黙らせる spy を仕込む
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // adapter
      const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
      // onListenerError 無しで manager を作る
      const manager = createAuthManager(adapter);
      // throw する listener
      manager.subscribe(() => {
        // 任意の例外を投げる
        throw new Error("boom-fallback");
      });
      // setSession 経由で emit を発火する
      await manager.setSession(createSession());
      // console.error が呼ばれていること
      expect(consoleErrorSpy).toHaveBeenCalled();
      // 引数のいずれかに Error が含まれていること (第 2 引数で渡している)
      const args = consoleErrorSpy.mock.calls[0] ?? [];
      // Error が含まれること
      expect(args.some((a) => a instanceof Error && (a as Error).message === "boom-fallback")).toBe(true);
    } finally {
      // 必ず spy を解放する
      consoleErrorSpy.mockRestore();
    }
  });

  // applySession の mutex: 並行 signIn / signOut / refresh でメモリと storage の整合が崩れない
  it("並行 signIn と signOut で current と tokenStore が食い違わない (mutex 直列化)", async () => {
    // tokenStore の操作順序を記録する spy
    const ops: string[] = [];
    const store = {
      async get() {
        return undefined;
      },
      async set(t: unknown) {
        // set 操作を記録
        ops.push(`set:${(t as { accessToken?: string }).accessToken ?? "?"}`);
        // マイクロタスクを跨ぐ
        await Promise.resolve();
      },
      async clear() {
        // clear 操作を記録
        ops.push("clear");
        await Promise.resolve();
      },
    } as const;
    const adapter: AuthAdapter = {
      // getSession は使われない経路
      getSession: vi.fn(async () => createSession()),
      // signIn は新セッションを返す
      signIn: vi.fn(async () => createSession("new")),
      // signOut は本テストでは no-op
      signOut: vi.fn(async () => undefined),
    };
    const manager = createAuthManager(adapter, { tokenStore: store });
    // signIn と signOut を並列発火 → mutex により直列化される
    await Promise.all([manager.signIn(), manager.signOut()]);
    // ops は「set:access-new → clear」または「clear → set:access-new」の 2 通りだが、
    // mutex 直列化により混在 (set 途中で clear が割り込む) は起きない
    expect(ops.length).toBe(2);
    expect(ops).toEqual(expect.arrayContaining(["clear"]));
    expect(ops.some((o) => o.startsWith("set:"))).toBe(true);
  });

  // getSnapshot は同一セッション中ずっと同じ参照を返すこと (#S3 cachedSnapshot)
  // useSyncExternalStore で Object.is 比較が安定するように
  it("getSnapshot は同一セッション中ずっと同じ参照を返す (#S3)", () => {
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter);
    // 連続して 2 回スナップショットを取る
    const s1 = manager.getSnapshot();
    const s2 = manager.getSnapshot();
    // 参照同一性が保たれていること (cachedSnapshot キャッシュ)
    expect(s1).toBe(s2);
  });

  // setSession 後の getSnapshot は新しい参照を返すこと (#S3 cachedSnapshot 無効化)
  it("setSession 後の getSnapshot は新しい参照を返す (#S3)", async () => {
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter);
    // 初期スナップショット
    const s1 = manager.getSnapshot();
    // セッションを更新する
    await manager.setSession(createSession("new"));
    // 更新後のスナップショット
    const s2 = manager.getSnapshot();
    // 参照は別であること
    expect(s1).not.toBe(s2);
    // 中身が新しいトークンで更新されていること
    expect(s2.tokens?.accessToken).toBe("new");
  });

  // emit がリスナーに渡すセッションは cachedSnapshot とは別参照であること (#C5 mutation 隔離)
  // 利用者が session を mutate しても内部状態が破壊されない
  it("emit がリスナーに渡すセッションは cachedSnapshot とは別参照 (#C5)", async () => {
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter);
    // listener が受け取ったセッションを記録する
    let captured: AuthSession | undefined;
    // 購読する
    manager.subscribe((session) => {
      // クロージャに保存
      captured = session;
    });
    // setSession で emit を発火させる
    await manager.setSession(createSession("forward-test"));
    // listener が受け取った参照と cachedSnapshot は別であること
    expect(captured).toBeDefined();
    expect(captured).not.toBe(manager.getSnapshot());
    // 中身は同じであること
    expect(captured?.tokens?.accessToken).toBe("forward-test");
    expect(manager.getSnapshot().tokens?.accessToken).toBe("forward-test");
  });

  // emit がリスナーに渡すセッションは listener 間でも別参照であること (#C5 listener 間隔離)
  it("emit がリスナーに渡すセッションは listener 間でも別参照 (#C5)", async () => {
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter);
    // 2 つの listener がそれぞれ受け取ったセッションを記録する
    let capturedA: AuthSession | undefined;
    let capturedB: AuthSession | undefined;
    // listener A
    manager.subscribe((session) => {
      capturedA = session;
    });
    // listener B
    manager.subscribe((session) => {
      capturedB = session;
    });
    // setSession で emit を発火
    await manager.setSession(createSession("isolated"));
    // それぞれ別オブジェクトで受け取っていること (mutation 干渉防止)
    expect(capturedA).toBeDefined();
    expect(capturedB).toBeDefined();
    expect(capturedA).not.toBe(capturedB);
  });

  // emit ループ中に subscribe された listener は同じ emit では呼ばれないこと (#C8 listeners snapshot)
  it("emit ループ中に subscribe された listener は同じ emit では呼ばれない (#C8)", async () => {
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter);
    // 後から追加されたとき呼ばれる listener
    const lateListener = vi.fn();
    // 最初の listener: 呼ばれたとき lateListener を subscribe する
    manager.subscribe(() => {
      // 同じ emit で lateListener が呼ばれてはいけない
      manager.subscribe(lateListener);
    });
    // 1 回目の emit を発火
    await manager.setSession(createSession("first"));
    // lateListener は今回 emit ではまだ呼ばれていないこと
    expect(lateListener).not.toHaveBeenCalled();
    // 2 回目の emit を発火
    await manager.setSession(createSession("second"));
    // lateListener は 2 回目以降の emit から呼ばれること (1 回目で登録された分が初通知)
    // ただし 1 回目の listener も再度実行されて、毎回 lateListener が増えるため、
    // 2 回目には少なくとも 1 回は呼ばれていることを確認 (回数は実装詳細に依存しないよう緩く)
    expect(lateListener.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  // tokenStore.set を直接呼んでも getAccessToken には反映されない仕様 (#C6 文書化テスト)
  // current が権威なので、manager の外から store を mutate しても current 経由の API には影響しない
  it("tokenStore.set を直接呼んでも getAccessToken には反映されない (current 優先設計の文書化) (#C6)", async () => {
    // 内部状態を持つ store
    let storedTokens: { accessToken?: string } | undefined;
    const store: TokenStore = {
      // 内部状態から最新値を返す
      get: vi.fn(async () => storedTokens),
      // 内部状態に書き込む
      set: vi.fn(async (tokens) => {
        // 値を保存する
        storedTokens = { ...tokens };
      }),
      // 内部状態をクリア
      clear: vi.fn(async () => {
        storedTokens = undefined;
      }),
    };
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter, { tokenStore: store });
    // signIn 経由で正規ルートで反映
    await manager.setSession(createSession("from-session"));
    // 期待通り from-session が返る
    expect(await manager.getAccessToken()).toBe("from-session");
    // ここで外部から直接 store を書き換える (本来は禁止された経路)
    await store.set({ accessToken: "external-tampered" });
    // current 優先設計のため、getAccessToken は引き続き from-session を返す
    expect(await manager.getAccessToken()).toBe("from-session");
    // 仕様: トークンを更新したい場合は manager.setSession / refresh / signIn を使うこと
  });

  // initialSession.tokens と外部 tokenStore を同時指定すると外部 store に同期される (#S5)
  it("initialSession.tokens と外部 tokenStore を同時指定すると外部 store に同期される (#S5)", async () => {
    // 外部 store の set を spy
    const store: TokenStore = {
      // 受け取りだけ
      get: vi.fn(async () => undefined),
      // seed の対象
      set: vi.fn(async () => undefined),
      // 受け取りだけ
      clear: vi.fn(async () => undefined),
    };
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // initialSession に tokens を含めて外部 store と一緒に渡す
    const manager = createAuthManager(adapter, {
      // 初期セッション (tokens あり)
      initialSession: createSession("seeded"),
      // 外部 store
      tokenStore: store,
    });
    // fire-and-forget seed の sessionMutex op を macrotask 1 つ待って flush する
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // 外部 store の set が initialSession.tokens で呼ばれていること
    expect(store.set).toHaveBeenCalledWith({ accessToken: "seeded" });
    // manager 自体は seed なしでも動作する (current.tokens が正しい)
    expect(await manager.getAccessToken()).toBe("seeded");
  });

  // refresh() は初期 tokenStore seed 後の値を adapter.refresh に渡す (#S5)
  it("refresh() は初期 tokenStore seed 後の値を adapter.refresh に渡す (#S5)", async () => {
    // 外部 store にseed され、refresh で参照される値
    let storedTokens: { accessToken?: string } | undefined;
    const store: TokenStore = {
      // 内部状態から最新値を返す
      get: vi.fn(async () => storedTokens),
      // seed 経路で書き込む
      set: vi.fn(async (tokens) => {
        // 内部状態に保存する
        storedTokens = { ...tokens };
      }),
      // 受け取りだけ
      clear: vi.fn(async () => {
        // 内部状態をクリア
        storedTokens = undefined;
      }),
    };
    // adapter: refresh は受け取った tokens 引数で確認できるよう vi.fn
    const adapter: AuthAdapter = {
      getSession: vi.fn(async () => createSession()),
      refresh: vi.fn(async () => createSession("refreshed")),
    };
    // initialSession + 外部 store
    const manager = createAuthManager(adapter, {
      // 初期セッション
      initialSession: createSession("seeded"),
      // 外部 store
      tokenStore: store,
    });
    // fire-and-forget seed の sessionMutex op を macrotask 1 つ待って flush する
    // (refresh の tokenStore.get は sessionMutex 外なので seed と競合し得る; macrotask 1 サイクルで seed は確実に完了)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // refresh を呼ぶ (この時点では seed 完了済みなので store.get は seeded を返す)
    await manager.refresh();
    // adapter.refresh には seed された seeded トークンが渡されたこと
    expect(adapter.refresh).toHaveBeenCalledWith({ accessToken: "seeded" });
  });

  // 外部 tokenStore.set が初期化時に reject しても manager は使用可能 (#S5)
  it("外部 tokenStore.set が初期化時に reject しても manager は使用可能 (#S5)", async () => {
    // console.warn を spy
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // store.set が必ず reject する
      const store: TokenStore = {
        // 受け取りだけ
        get: vi.fn(async () => undefined),
        // 常に reject
        set: vi.fn(async () => {
          // I/O 失敗をシミュレート
          throw new Error("store-seed-failed");
        }),
        // 受け取りだけ
        clear: vi.fn(async () => undefined),
      };
      // adapter
      const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
      // initialSession + 失敗する外部 store
      const manager = createAuthManager(adapter, {
        // 初期セッション
        initialSession: createSession("seeded"),
        // reject する store
        tokenStore: store,
      });
      // seed の sessionMutex op を macrotask 1 つ待って flush する (rejection の catch を実行させる)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      // console.warn が呼ばれていること (seed 失敗の警告)
      const seedWarning = consoleWarnSpy.mock.calls.find((args) =>
        args.some(
          (a) =>
            typeof a === "string" && a.includes("failed to seed external tokenStore"),
        ),
      );
      // 該当する呼び出しがあること
      expect(seedWarning).toBeDefined();
      // manager は引き続き使用可能 (current.tokens は seeded のまま)
      expect(await manager.getAccessToken()).toBe("seeded");
    } finally {
      // 必ず spy を解放する
      consoleWarnSpy.mockRestore();
    }
  });

  // 不整合な initialSession (authenticated + user=null) では loaded=false で adapter から再取得する (#S2)
  it("不整合な initialSession (authenticated + user=null) では loaded=false で adapter から再取得する (#S2)", async () => {
    // console.warn を spy (警告メッセージの検証用)
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // adapter は認証済みセッションを返せる
      const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
      // 不整合 initialSession (status=authenticated だが user=null)
      const manager = createAuthManager(adapter, {
        // 不整合入力
        initialSession: { status: "authenticated", user: null },
      });
      // 警告が出ていること
      expect(consoleWarnSpy).toHaveBeenCalled();
      // adapter からの再取得を試みる
      await manager.getSession();
      // loaded=false だったので adapter.getSession が呼ばれていること
      expect(adapter.getSession).toHaveBeenCalled();
    } finally {
      // 必ず spy を解放する
      consoleWarnSpy.mockRestore();
    }
  });

  // 意図的な anonymous initialSession は loaded=true として adapter を呼ばない (#S2)
  it("意図的な anonymous initialSession は loaded=true として adapter を呼ばない (#S2)", async () => {
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // 意図的に anonymous を渡す
    const manager = createAuthManager(adapter, {
      // 匿名状態 (整合入力)
      initialSession: { status: "anonymous", user: null },
    });
    // adapter を呼ばずに匿名を維持
    const session = await manager.getSession();
    // adapter は呼ばれない
    expect(adapter.getSession).not.toHaveBeenCalled();
    // 匿名が返る
    expect(session.status).toBe("anonymous");
  });

  // onListenerError 自身が throw しても emit ループは継続し console.error にフォールバックすること (#C4)
  it("onListenerError 自身が throw しても emit ループは継続し console.error にフォールバックする (#C4)", async () => {
    // console.error を黙らせる spy を仕込む
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // hook 自身が throw する onListenerError
      const onListenerError = vi.fn(() => {
        // 任意の例外を投げる
        throw new Error("hook-broken");
      });
      // adapter
      const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
      // manager
      const manager = createAuthManager(adapter, { onListenerError });
      // throw する listener A
      manager.subscribe(() => {
        // 任意の例外を投げる
        throw new Error("listener-boom");
      });
      // 通常の listener B (A の後ろに登録、emit ループ継続を検証)
      const listenerB = vi.fn();
      manager.subscribe(listenerB);
      // setSession で emit を発火
      await manager.setSession(createSession());
      // listenerB は A の throw と hook の throw 両方に関わらず 1 回呼ばれていること
      expect(listenerB).toHaveBeenCalledTimes(1);
      // onListenerError が呼ばれたこと
      expect(onListenerError).toHaveBeenCalled();
      // console.error が hook 自身の throw を通知していること (引数のいずれかに "hook itself threw" を含む)
      const hookErrorCall = consoleErrorSpy.mock.calls.find((args) =>
        args.some((a) => typeof a === "string" && a.includes("onListenerError hook itself threw")),
      );
      // 該当する呼び出しがあること
      expect(hookErrorCall).toBeDefined();
    } finally {
      // 必ず spy を解放する
      consoleErrorSpy.mockRestore();
    }
  });

  // async listener の rejection は onListenerError に通知されること (#C7)
  it("async listener の rejection は onListenerError に通知される (#C7)", async () => {
    // observability フックを spy する
    const onListenerError = vi.fn();
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter, { onListenerError });
    // async listener (Promise<void> を返す関数で throw)
    manager.subscribe(async () => {
      // 非同期的に throw する
      throw new Error("async-boom");
    });
    // setSession で emit を発火
    await manager.setSession(createSession());
    // rejection は次のマイクロタスクで処理されるので flush する
    await Promise.resolve();
    await Promise.resolve();
    // onListenerError が async rejection を捕捉していること
    expect(onListenerError).toHaveBeenCalledTimes(1);
    // 受け取ったエラーは "async-boom"
    expect((onListenerError.mock.calls[0]?.[0] as Error).message).toBe("async-boom");
    // 第 2 引数は emit 時のイベント名
    expect(onListenerError.mock.calls[0]?.[1]).toBe("sessionChanged");
  });

  // async listener が onListenerError 未指定時は console.error にフォールバック (#C7)
  it("async listener の rejection は onListenerError 未指定時に console.error にフォールバックする (#C7)", async () => {
    // console.error を spy
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // adapter
      const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
      // onListenerError 無しで manager を作る
      const manager = createAuthManager(adapter);
      // async listener が throw
      manager.subscribe(async () => {
        // 非同期的に throw する
        throw new Error("async-fallback-boom");
      });
      // setSession で emit を発火
      await manager.setSession(createSession());
      // rejection は次のマイクロタスクで処理されるので flush する
      await Promise.resolve();
      await Promise.resolve();
      // console.error が呼ばれていて、Error の message が "async-fallback-boom" を含むこと
      const matched = consoleErrorSpy.mock.calls.some((args) =>
        args.some((a) => a instanceof Error && a.message === "async-fallback-boom"),
      );
      expect(matched).toBe(true);
    } finally {
      // 必ず spy を解放する
      consoleErrorSpy.mockRestore();
    }
  });

  // emit ループ中に unsubscribe された listener は今回 emit ではまだ呼ばれること (#C8 listeners snapshot)
  // (listeners snapshot を取ってから反復するので、unsubscribe しても snapshot 配列には残っている)
  it("emit ループ中に unsubscribe された listener は今回 emit ではまだ呼ばれる (#C8)", async () => {
    // adapter
    const adapter: AuthAdapter = { getSession: vi.fn(async () => createSession()) };
    // manager
    const manager = createAuthManager(adapter);
    // B の呼び出し回数をカウント
    const listenerB = vi.fn();
    // B を先に登録して unsubscribe ハンドラを得る
    const unsubscribeB = manager.subscribe(listenerB);
    // A は呼ばれた際に B を即座に unsubscribe する
    manager.subscribe(() => {
      unsubscribeB();
    });
    // emit を発火
    await manager.setSession(createSession("snapshot-test"));
    // snapshot 反復方式なので B も今回 emit ではまだ呼ばれること
    expect(listenerB).toHaveBeenCalledTimes(1);
    // 2 回目以降は呼ばれないこと
    await manager.setSession(createSession("snapshot-test-2"));
    // 1 回目分のままで 2 回目では呼ばれない
    expect(listenerB).toHaveBeenCalledTimes(1);
  });
});
