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
// Context を取り込み
import { useAuthContext } from "./hooks.js";

// 認証済みセッションを返すヘルパ
function makeAuthSession(accessToken = "token-1"): AuthSession {
  // 認証済み AuthSession を返す
  return {
    // 認証済み
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

// Context の中身を取り出す Probe
type ContextProbe = {
  loading: boolean;
  error: unknown;
  session: AuthSession;
  reload: () => Promise<AuthSession>;
};

// Probe コンポーネントを作るヘルパ
function makeProbe(target: { current: ContextProbe | undefined }) {
  // 関数コンポーネントを返す
  return function Probe(): React.JSX.Element {
    // Context を取得する
    const ctx = useAuthContext();
    // テストから参照できる場所に書き込む
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
describe("AuthProvider", () => {
  // loadOnMount=true で adapter.getSession を呼んで反映すること
  it("loadOnMount=true のとき初期ロードで adapter.getSession({ refresh: true }) を呼ぶ", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // 認証済みセッションを返す
      getSession: vi.fn(async () => makeAuthSession()),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // Probe の参照を用意する
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe コンポーネント
    const Probe = makeProbe(ref);
    // 非同期描画を待つために flush を多めに行う
    await act(async () => {
      // Provider 配下で Probe を描画
      create(
        <AuthProvider manager={manager} loadOnMount>
          <Probe />
        </AuthProvider>,
      );
    });
    // adapter.getSession が呼ばれていること
    expect(adapter.getSession).toHaveBeenCalled();
    // 認証済みになっていること
    expect(ref.current?.session.status).toBe("authenticated");
    // ロード完了後は loading=false
    expect(ref.current?.loading).toBe(false);
    // エラーは null
    expect(ref.current?.error).toBeNull();
  });

  // loadOnMount=false 時は adapter を呼ばないこと
  it("loadOnMount=false のとき adapter.getSession を呼ばない", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // 取得モック
      getSession: vi.fn(async () => makeAuthSession()),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // Probe 参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref);
    // 描画する
    await act(async () => {
      // loadOnMount を省略
      create(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
    });
    // adapter.getSession は呼ばれていないこと
    expect(adapter.getSession).not.toHaveBeenCalled();
    // loading=false（初期状態のまま）
    expect(ref.current?.loading).toBe(false);
    // session は manager の snapshot 由来で匿名
    expect(ref.current?.session.status).toBe("anonymous");
  });

  // getSession が reject したとき error にセットされ匿名へフォールバックすること
  it("初期ロードが reject した場合は error に格納し loading=false にする", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // reject する getSession
      getSession: vi.fn(async () => {
        // 任意の例外を投げる
        throw new Error("boom");
      }),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // Probe 参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref);
    // 描画する
    await act(async () => {
      // loadOnMount=true で reject を発火させる
      create(
        <AuthProvider manager={manager} loadOnMount>
          <Probe />
        </AuthProvider>,
      );
    });
    // error がセットされていること
    expect((ref.current?.error as Error | undefined)?.message).toBe("boom");
    // loading は false
    expect(ref.current?.loading).toBe(false);
    // session は匿名
    expect(ref.current?.session.status).toBe("anonymous");
  });

  // reload() を呼ぶと再フェッチされること
  it("reload() を呼ぶと adapter.getSession が再度呼ばれる", async () => {
    // 呼び出し回数を制御する変数
    let callCount = 0;
    // adapter を作る
    const adapter: AuthAdapter = {
      // 呼ぶたびに違うトークンを返す
      getSession: vi.fn(async () => {
        // カウントを更新する
        callCount += 1;
        // 末尾にカウントを付与
        return makeAuthSession(`token-${callCount}`);
      }),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // Probe 参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref);
    // 初期描画
    await act(async () => {
      // loadOnMount=true で 1 回目を発火
      create(
        <AuthProvider manager={manager} loadOnMount>
          <Probe />
        </AuthProvider>,
      );
    });
    // 1 回目のトークンが反映されていること
    expect(ref.current?.session.tokens?.accessToken).toBe("token-1");
    // reload を実行する
    await act(async () => {
      // reload を呼ぶ
      await ref.current?.reload();
    });
    // 2 回目のトークンが反映されていること
    expect(ref.current?.session.tokens?.accessToken).toBe("token-2");
    // adapter が 2 回呼ばれていること
    expect(adapter.getSession).toHaveBeenCalledTimes(2);
  });

  // manager.subscribe 経由でセッション変化が反映されること
  it("manager の購読経由でセッション変化が Context に伝搬する", async () => {
    // adapter を作る
    const adapter: AuthAdapter = {
      // 認証済みセッションを返す
      getSession: vi.fn(async () => makeAuthSession()),
    };
    // manager を作る
    const manager = createAuthManager(adapter);
    // Probe 参照
    const ref: { current: ContextProbe | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref);
    // 初期描画（loadOnMount は false で開始する）
    await act(async () => {
      // Provider を配置
      create(
        <AuthProvider manager={manager}>
          <Probe />
        </AuthProvider>,
      );
    });
    // 初期は匿名
    expect(ref.current?.session.status).toBe("anonymous");
    // setSession で外から差し替える
    await act(async () => {
      // 認証済みに差し替える
      await manager.setSession(makeAuthSession("forced"));
    });
    // Context の session に伝わっていること
    expect(ref.current?.session.tokens?.accessToken).toBe("forced");
  });
});
