// React の hook を取り込み
import { useCallback, useEffect, useRef, useState } from "react";
// HTTP クライアント関連の型を core から取り込み
import type {
  HttpError,
  HttpRequestInit,
} from "@k1s0-ts-http/core";
// 親クライアント取得
import { useHttpClient } from "./hooks.js";

// useHttpQuery の戻り値型
export interface HttpQueryState<T> {
  // 取得済みデータ（未取得 or エラー時は undefined）
  data: T | undefined;
  // 直近のエラー（成功時は undefined）
  error: HttpError | undefined;
  // ローディング中フラグ
  loading: boolean;
  // 直近リクエストの相関 ID
  requestId: string | undefined;
  // 強制再 fetch（手動リフレッシュ）
  refetch: () => void;
}

// 軽量な GET 等の問い合わせ Hook
// init が依存配列で変わるたびに再 fetch、unmount や次回 fetch で前回 request を abort する
export function useHttpQuery<T = unknown>(
  init: HttpRequestInit,
  deps: readonly unknown[] = [],
): HttpQueryState<T> {
  // 親クライアントを取得
  const client = useHttpClient();
  // 状態保持
  const [state, setState] = useState<{
    data: T | undefined;
    error: HttpError | undefined;
    loading: boolean;
    requestId: string | undefined;
  }>({ data: undefined, error: undefined, loading: true, requestId: undefined });
  // 直前の AbortController を保持（再 fetch 時に abort するため）
  const ctrlRef = useRef<AbortController | null>(null);
  // fetch 実行ヘルパ（refetch から再利用）
  const fetchOnce = useCallback(() => {
    // 前回の request を abort
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    // loading 状態へ
    setState((s) => ({ ...s, loading: true }));
    // 実行
    client
      .request<T>({ ...init, signal: ctrl.signal })
      .then((res) => {
        // unmount 後の状態更新を避ける（abort 済みなら無視）
        if (ctrl.signal.aborted) return;
        setState({
          data: res.body,
          error: undefined,
          loading: false,
          requestId: res.request.requestId,
        });
      })
      .catch((err: unknown) => {
        // HttpError の ABORTED は次回 fetch による意図的中断なので state は更新しない
        const e = err as HttpError;
        if (e?.code === "ABORTED") return;
        setState({
          data: undefined,
          error: e,
          loading: false,
          requestId: e?.requestId,
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, ...deps]);
  // 依存変化で fetch（unmount 時は abort）
  useEffect(() => {
    fetchOnce();
    return () => {
      ctrlRef.current?.abort();
    };
  }, [fetchOnce]);
  return { ...state, refetch: fetchOnce };
}

// useHttpMutation の戻り値型
export interface HttpMutationState<TBody, TRes> {
  // 直近の成功データ
  data: TRes | undefined;
  // 直近のエラー
  error: HttpError | undefined;
  // 実行中フラグ
  loading: boolean;
  // 実行関数（body と任意の上書きを受け取り Promise<TRes> を返す）
  mutate: (
    body: TBody,
    override?: Partial<HttpRequestInit>,
  ) => Promise<TRes>;
  // 状態をリセット
  reset: () => void;
}

// POST 等の変更操作 Hook
export function useHttpMutation<TBody = unknown, TRes = unknown>(
  init: Omit<HttpRequestInit, "body">,
): HttpMutationState<TBody, TRes> {
  // 親クライアントを取得
  const client = useHttpClient();
  // 状態保持
  const [state, setState] = useState<{
    data: TRes | undefined;
    error: HttpError | undefined;
    loading: boolean;
  }>({ data: undefined, error: undefined, loading: false });
  // mutate 関数（unmount 後の state 更新を避けるため mounted ref を持つ）
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // 実行関数
  const mutate = useCallback(
    async (body: TBody, override?: Partial<HttpRequestInit>): Promise<TRes> => {
      // loading 状態へ
      if (mountedRef.current) setState((s) => ({ ...s, loading: true }));
      try {
        // 実行（body と override を init に合成）
        const res = await client.request<TRes>({
          ...init,
          ...override,
          body: body as BodyInit | null | undefined,
        });
        // unmount 後でなければ state 更新
        if (mountedRef.current) {
          setState({ data: res.body, error: undefined, loading: false });
        }
        return res.body;
      } catch (err) {
        // unmount 後でなければ state 更新
        if (mountedRef.current) {
          setState({
            data: undefined,
            error: err as HttpError,
            loading: false,
          });
        }
        throw err;
      }
    },
    [client, init],
  );
  // リセット関数
  const reset = useCallback(() => {
    setState({ data: undefined, error: undefined, loading: false });
  }, []);
  return { ...state, mutate, reset };
}
