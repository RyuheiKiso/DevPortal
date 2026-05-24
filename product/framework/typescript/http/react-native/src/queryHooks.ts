// React の hook を取り込み
import { useCallback, useEffect, useRef, useState } from "react";
// HTTP クライアント関連の型を core から取り込み
import type {
  HttpError,
  HttpRequestInit,
} from "@k1s0-ts-http/core";
// 親クライアント取得
import { useHttpClient } from "./hooks.js";

// useHttpQuery の戻り値型（react 版と同一）
export interface HttpQueryState<T> {
  data: T | undefined;
  error: HttpError | undefined;
  loading: boolean;
  requestId: string | undefined;
  refetch: () => void;
}

// 軽量な問い合わせ Hook（react 版と同実装）
export function useHttpQuery<T = unknown>(
  init: HttpRequestInit,
  deps: readonly unknown[] = [],
): HttpQueryState<T> {
  const client = useHttpClient();
  const [state, setState] = useState<{
    data: T | undefined;
    error: HttpError | undefined;
    loading: boolean;
    requestId: string | undefined;
  }>({ data: undefined, error: undefined, loading: true, requestId: undefined });
  const ctrlRef = useRef<AbortController | null>(null);
  const fetchOnce = useCallback(() => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setState((s) => ({ ...s, loading: true }));
    client
      .request<T>({ ...init, signal: ctrl.signal })
      .then((res) => {
        if (ctrl.signal.aborted) return;
        setState({
          data: res.body,
          error: undefined,
          loading: false,
          requestId: res.request.requestId,
        });
      })
      .catch((err: unknown) => {
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
  data: TRes | undefined;
  error: HttpError | undefined;
  loading: boolean;
  mutate: (
    body: TBody,
    override?: Partial<HttpRequestInit>,
  ) => Promise<TRes>;
  reset: () => void;
}

// POST 等の変更操作 Hook（react 版と同実装）
export function useHttpMutation<TBody = unknown, TRes = unknown>(
  init: Omit<HttpRequestInit, "body">,
): HttpMutationState<TBody, TRes> {
  const client = useHttpClient();
  const [state, setState] = useState<{
    data: TRes | undefined;
    error: HttpError | undefined;
    loading: boolean;
  }>({ data: undefined, error: undefined, loading: false });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const mutate = useCallback(
    async (body: TBody, override?: Partial<HttpRequestInit>): Promise<TRes> => {
      if (mountedRef.current) setState((s) => ({ ...s, loading: true }));
      try {
        const res = await client.request<TRes>({
          ...init,
          ...override,
          body: body as HttpRequestInit["body"],
        });
        if (mountedRef.current) {
          setState({ data: res.body, error: undefined, loading: false });
        }
        return res.body;
      } catch (err) {
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
  const reset = useCallback(() => {
    setState({ data: undefined, error: undefined, loading: false });
  }, []);
  return { ...state, mutate, reset };
}
