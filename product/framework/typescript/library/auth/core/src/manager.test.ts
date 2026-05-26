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

  // applySession 進行中 (current 更新済み・store.set pending) の並行 getAccessToken が current の新トークンを返すこと (#2 競合修正の核心)
  it("applySession 進行中の並行 getAccessToken が current の新トークンを返す (mutex 競合解消)", async () => {
    // store.set を外部から resolve できるゲートで遅延させ、競合窓を再現する
    let releaseStoreSet: (() => void) | undefined;
    // store.set が pending の間ずっと止まる Promise
    const storeSetGate = new Promise<void>((resolve) => {
      // resolve を外に取り出す
      releaseStoreSet = resolve;
    });
    // store 実装
    const store: TokenStore = {
      // 古い値を返す (修正前はこちらが優先されていた)
      get: vi.fn(async () => ({ accessToken: "old-stored" })),
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
    // setSession を await せずに発火 (applySession 内で current は同期更新済み、store.set はゲートで pending)
    const setSessionPromise = manager.setSession({
      // 認証済み状態
      status: "authenticated",
      // 最小ユーザー
      user: { id: "user-1", roles: [], permissions: [] },
      // 新トークン
      tokens: { accessToken: "new-access" },
    });
    // applySession の中の `current = normalizeSession(...)` まで進めるためにマイクロタスクを数回進める
    // (sessionMutex の chain.then(op, op) と applySession 内の op() で最低 2-3 microtask を要する)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // この時点で current.tokens は new-access、store はまだ old-stored のまま
    // 修正前は store 優先だったため "old-stored" が返っていた
    // 修正後は current 優先なので "new-access" が返る
    expect(await manager.getAccessToken()).toBe("new-access");
    // ヘッダ取得も新トークンで組み立てられること
    expect(await manager.getAuthHeaders()).toEqual({ Authorization: "Bearer new-access" });
    // ゲートを開いて applySession を完走させる
    releaseStoreSet?.();
    // setSession の完了を待つ (リーク防止)
    await setSessionPromise;
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
});
