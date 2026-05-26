// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// React を取り込み
import * as React from "react";
// react-test-renderer を取り込み
import { act, create } from "react-test-renderer";
// core から manager 生成と型を取り込み
import { createAuthManager } from "@k1s0-ts-auth/core";
// 型を取り込み
import type { AuthAdapter, AuthSession } from "@k1s0-ts-auth/core";
// テスト対象を取り込み
import { AuthProvider } from "./AuthProvider.js";
// Context hook を取り込み
import { useAuthContext } from "./hooks.js";

// 認証済みセッションを返すヘルパ
function makeAuthSession(accessToken = "token-1"): AuthSession {
  // AuthSession を返す
  return {
    // 認証済み状態
    status: "authenticated",
    // 最小ユーザー
    user: {
      // id
      id: "user-1",
      // ロール
      roles: ["admin"],
      // 権限
      permissions: ["invoice:read"],
    },
    // トークン
    tokens: { accessToken },
  };
}

// Context Probe の型
type ContextProbe = {
  loading: boolean;
  error: unknown;
  session: AuthSession;
  reload: () => Promise<AuthSession>;
};

// Probe コンポーネントを返すヘルパ
function makeProbe(target: { current: ContextProbe | undefined }) {
  // Probe 本体
  return function Probe(): React.JSX.Element {
    // Context を取得する
    const ctx = useAuthContext();
    // 参照に書き込む
    target.current = {
      // loading
      loading: ctx.loading,
      // error
      error: ctx.error,
      // session
      session: ctx.session,
      // reload
      reload: ctx.reload,
    };
    // 描画は空
    return <>{null}</>;
  };
}

// AuthProvider のテスト
describe("AuthProvider (react-native)", () => {
  // loadOnMount=true で adapter.getSession を呼んで反映すること
  it("loadOnMount=true のとき初期ロードで adapter.getSession を呼ぶ", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 認証済みセッションを返す
      getSession: vi.fn(async () => makeAuthSession()),
    };
    // manager
    const manager = createAuthManager(adapter);
    // Probe 参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref);
    // 非同期描画を flush するため async act を使う
    await act(async () => {
      // Provider 配下に Probe を描画
      create(
        <AuthProvider manager={manager} loadOnMount>
          <Probe />
        </AuthProvider>,
      );
    });
    // adapter が呼ばれていること
    expect(adapter.getSession).toHaveBeenCalled();
    // 認証済みであること
    expect(ref.current?.session.status).toBe("authenticated");
    // loading は false
    expect(ref.current?.loading).toBe(false);
    // error は null
    expect(ref.current?.error).toBeNull();
  });

  // loadOnMount=false 時は adapter を呼ばないこと
  it("loadOnMount=false のとき adapter.getSession を呼ばない", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // モック
      getSession: vi.fn(async () => makeAuthSession()),
    };
    // manager
    const manager = createAuthManager(adapter);
    // Probe 参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref);
    // 描画
    await act(async () => {
      // loadOnMount 省略
      create(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
    });
    // 呼ばれていないこと
    expect(adapter.getSession).not.toHaveBeenCalled();
    // loading は false
    expect(ref.current?.loading).toBe(false);
    // 匿名であること
    expect(ref.current?.session.status).toBe("anonymous");
  });

  // getSession が reject したとき error にセットされ匿名へフォールバックすること
  it("初期ロードが reject した場合は error に格納し loading=false にする", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 例外を投げる
      getSession: vi.fn(async () => {
        // 任意の例外
        throw new Error("native-boom");
      }),
    };
    // manager
    const manager = createAuthManager(adapter);
    // Probe 参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref);
    // 描画
    await act(async () => {
      // loadOnMount=true
      create(
        <AuthProvider manager={manager} loadOnMount>
          <Probe />
        </AuthProvider>,
      );
    });
    // error が格納されていること
    expect((ref.current?.error as Error | undefined)?.message).toBe("native-boom");
    // loading は false
    expect(ref.current?.loading).toBe(false);
    // 匿名であること
    expect(ref.current?.session.status).toBe("anonymous");
  });

  // reload() で再フェッチされること
  it("reload() で adapter.getSession が再度呼ばれる", async () => {
    // 呼び出し回数
    let count = 0;
    // adapter
    const adapter: AuthAdapter = {
      // 呼ぶたびに違うトークンを返す
      getSession: vi.fn(async () => {
        // インクリメント
        count += 1;
        // ユニークトークンを返す
        return makeAuthSession(`token-${count}`);
      }),
    };
    // manager
    const manager = createAuthManager(adapter);
    // Probe 参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref);
    // 初期描画
    await act(async () => {
      // loadOnMount=true で 1 回目
      create(
        <AuthProvider manager={manager} loadOnMount>
          <Probe />
        </AuthProvider>,
      );
    });
    // 1 回目のトークン
    expect(ref.current?.session.tokens?.accessToken).toBe("token-1");
    // reload
    await act(async () => {
      // 2 回目を発火
      await ref.current?.reload();
    });
    // 2 回目のトークン
    expect(ref.current?.session.tokens?.accessToken).toBe("token-2");
    // 呼ばれた回数を確認
    expect(adapter.getSession).toHaveBeenCalledTimes(2);
  });

  // subscribe 登録直後に manager の最新スナップショットへ再同期される
  // (Strict Mode の二重 mount / unmount→remount で subscribe〜unsubscribe〜subscribe の間に
  //  manager 側で変化が起きても取り逃がさないことを担保する)
  it("subscribe 登録直後に manager.getSnapshot で再同期される", async () => {
    // 初期は匿名で始まる adapter
    const adapter: AuthAdapter = {
      // 匿名セッションを返す
      getSession: vi.fn(async () => ({ status: "anonymous" })),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // provider が subscribe する前にセッションを更新しておく
    await manager.setSession(makeAuthSession("pre-mount"));
    // Probe で session を観察するための参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe コンポーネント
    const Probe = makeProbe(ref);
    // provider を mount
    await act(async () => {
      // Provider 配下で Probe を描画
      create(
        <AuthProvider manager={manager} loadOnMount={false}>
          <Probe />
        </AuthProvider>,
      );
    });
    // useState の初期値で取得した snapshot に加え、useEffect 内の再同期も走るため、
    // 最終的には manager.getSnapshot 由来の値 (pre-mount) が反映される
    expect(ref.current?.session.tokens?.accessToken).toBe("pre-mount");
  });

  // useEffect 内で manager.getSnapshot が呼ばれる (再同期 1 行が消えた瞬間 fail する強い回帰防止)
  it("subscribe 後に manager.getSnapshot が呼ばれる", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 認証済みセッションを返す
      getSession: vi.fn(async () => makeAuthSession()),
    };
    // manager
    const manager = createAuthManager(adapter);
    // getSnapshot spy を mount 直前に仕込む
    const getSnapshotSpy = vi.spyOn(manager, "getSnapshot");
    // Probe 参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref);
    // 描画 (loadOnMount=false で初期ロードは発火させない)
    await act(async () => {
      // Provider
      create(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
    });
    // useState 初期化 (1 回) + useEffect 内の再同期 (1 回) で 2 回以上呼ばれているはず
    expect(getSnapshotSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    // spy 解放
    getSnapshotSpy.mockRestore();
  });

  // manager.subscribe 経由でセッション変化が反映されること
  it("manager の購読経由でセッション変化が Context に伝搬する", async () => {
    // adapter
    const adapter: AuthAdapter = {
      // 認証済みを返す
      getSession: vi.fn(async () => makeAuthSession()),
    };
    // manager
    const manager = createAuthManager(adapter);
    // Probe 参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref);
    // 初期描画（loadOnMount=false）
    await act(async () => {
      // Provider 配置
      create(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
    });
    // 初期は匿名
    expect(ref.current?.session.status).toBe("anonymous");
    // setSession で差し替え
    await act(async () => {
      // 認証済みに切り替え
      await manager.setSession(makeAuthSession("forced-native"));
    });
    // Context の session に伝わっていること
    expect(ref.current?.session.tokens?.accessToken).toBe("forced-native");
  });
});
