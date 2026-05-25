// React の型と hook を取り込み
import type { ReactElement, ReactNode } from "react";
// React の hook を取り込み
import { useCallback, useEffect, useMemo, useState } from "react";
// core から型と匿名セッション生成を取り込み
import type { AuthManager, AuthSession } from "@k1s0-ts-auth/core";
// core から匿名セッション生成を取り込み
import { createAnonymousSession } from "@k1s0-ts-auth/core";
// Context 本体を取り込み
import { AuthContext } from "./context.js";

// AuthProvider の props 型
export interface AuthProviderProps {
  // アプリで利用する AuthManager
  manager: AuthManager;
  // ラップする子要素
  children: ReactNode;
  // mount 時に manager.getSession({ refresh: true }) を呼ぶか
  loadOnMount?: boolean;
}

// React ツリーへ認証状態を提供する Provider
export function AuthProvider(props: AuthProviderProps): ReactElement {
  // manager の現在スナップショットを初期値にする
  const [session, setSession] = useState<AuthSession>(() => props.manager.getSnapshot());
  // loadOnMount が true の場合だけ初期 loading とする
  const [loading, setLoading] = useState<boolean>(props.loadOnMount === true);
  // セッション取得エラーを保持する
  const [error, setError] = useState<unknown>(null);

  // セッションを再取得する関数を定義する
  const reload = useCallback(async (): Promise<AuthSession> => {
    // loading を開始する
    setLoading(true);
    // 直前のエラーを消す
    setError(null);
    // manager から最新セッションを取得する
    try {
      // 強制更新で取得する
      const next = await props.manager.getSession({ refresh: true });
      // 取得したセッションを state に反映する
      setSession(next);
      // 取得したセッションを返す
      return next;
    } catch (caught) {
      // エラーを state に反映する
      setError(caught);
      // エラー時は匿名セッションを返す
      return createAnonymousSession();
    } finally {
      // loading を終了する
      setLoading(false);
    }
  }, [props.manager]);

  // manager の購読と初期ロードを行う
  useEffect(() => {
    // manager の状態変化を React state に同期する
    const unsubscribe = props.manager.subscribe((next) => setSession(next));
    // loadOnMount が true の場合だけ初期ロードする
    if (props.loadOnMount === true) {
      // 非同期ロードを開始する
      void reload();
    }
    // unmount 時に購読解除する
    return unsubscribe;
  }, [props.loadOnMount, props.manager, reload]);

  // Context に渡す値を安定化する
  const value = useMemo(
    // Context 値を組み立てる
    () => ({ manager: props.manager, session, loading, error, reload }),
    // 依存値が変わったときだけ再生成する
    [error, loading, props.manager, reload, session],
  );

  // Context Provider で子要素をラップする
  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}
