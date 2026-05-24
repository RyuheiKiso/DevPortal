// React の hook を取り込み
import { useCallback, useEffect, useRef, useState } from "react";
// HTTP クライアント関連の型と HttpError を core から取り込み
import { HttpError } from "@k1s0-ts-http/core";
import type { HttpRequestInit } from "@k1s0-ts-http/core";
// 親クライアント取得
import { useHttpClient } from "./hooks.js";

// HttpRequestInit["body"] の型エイリアス（BodyInit | null | undefined と等価、RN の lib に DOM が無いため）
type MutationBody = NonNullable<HttpRequestInit["body"]>;

// 任意の throw 値を HttpError にラップ（duck-typing 解消、B-14）
function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof Error) {
    return new HttpError({
      message: err.message,
      code: "UNKNOWN",
      retryable: false,
      cause: err,
    });
  }
  return new HttpError({
    message: `non-Error thrown: ${String(err)}`,
    code: "UNKNOWN",
    retryable: false,
    cause: err,
  });
}

// useHttpQuery のオプション（B-10、react 版と同型）
export interface HttpQueryOptions {
  deps?: readonly unknown[];
  enabled?: boolean;
}

// useHttpQuery の戻り値型
export interface HttpQueryState<T> {
  data: T | undefined;
  error: HttpError | undefined;
  loading: boolean;
  requestId: string | undefined;
  // 強制再 fetch（Promise を返す、B-15）
  refetch: () => Promise<void>;
}

// 軽量な問い合わせ Hook（react 版と同実装）
export function useHttpQuery<T = unknown>(
  init: HttpRequestInit,
  options: HttpQueryOptions = {},
): HttpQueryState<T> {
  const client = useHttpClient();
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<{
    data: T | undefined;
    error: HttpError | undefined;
    loading: boolean;
    requestId: string | undefined;
  }>({
    data: undefined,
    error: undefined,
    loading: enabled,
    requestId: undefined,
  });
  const ctrlRef = useRef<AbortController | null>(null);
  // 最新 init を ref に保存（stale closure 防止）
  const initRef = useRef(init);
  initRef.current = init;
  const deps = options.deps;
  // fetch 実行ヘルパ（Promise を返す、B-15）
  const fetchOnce = useCallback((): Promise<void> => {
    ctrlRef.current?.abort();
    // enabled=false なら fetch しない（loading 状態変更不要なら setState skip、R-A2）
    if (!enabled) {
      ctrlRef.current = null;
      setState((s) => (s.loading ? { ...s, loading: false } : s));
      return Promise.resolve();
    }
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    return client
      .request<T>({ ...initRef.current, signal: ctrl.signal })
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
        if (ctrl.signal.aborted) return;
        const httpErr = toHttpError(err);
        if (httpErr.code === "ABORTED") return;
        setState({
          data: undefined,
          error: httpErr,
          loading: false,
          requestId: httpErr.requestId,
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, enabled, ...(deps ?? [])]);
  useEffect(() => {
    void fetchOnce();
    return () => {
      ctrlRef.current?.abort();
    };
  }, [fetchOnce]);
  return { ...state, refetch: fetchOnce };
}

// useHttpMutation の戻り値型（B-13 で mutate / mutateAsync に分離、R-A4 で TBody 制約を明示）
export interface HttpMutationState<TBody, TRes> {
  data: TRes | undefined;
  error: HttpError | undefined;
  loading: boolean;
  // fire-and-forget 実行（throw しない、エラーは state.error）
  mutate: (body: TBody, override?: Partial<HttpRequestInit>) => void;
  // 実行（throw する、await 可能）
  mutateAsync: (body: TBody, override?: Partial<HttpRequestInit>) => Promise<TRes>;
  reset: () => void;
}

/**
 * POST 等の変更操作 Hook（react 版と同実装）
 *
 * 注意（R-A4）:
 * - TBody は fetch の HttpRequestInit["body"] 互換が必須（string / FormData / Blob / URLSearchParams / ArrayBuffer 等）
 * - JSON を送る場合は呼び出し側で JSON.stringify し、headers: { "Content-Type": "application/json" } を指定
 * - もしくは core の post(client, url, body, init) ヘルパを使う（自動 JSON stringify）
 *
 * Race 防止（R-A1）: 連続 mutate 時は最後の呼び出しのみが state に反映される
 */
export function useHttpMutation<TBody extends MutationBody = MutationBody, TRes = unknown>(
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
  // 最新 init を ref に保存（A8）
  const initRef = useRef(init);
  initRef.current = init;
  // 最新呼び出し ID（R-A1: race 防止用）
  const latestCallIdRef = useRef(0);
  // mutateAsync 実体（throw する）
  const mutateAsync = useCallback(
    async (body: TBody, override?: Partial<HttpRequestInit>): Promise<TRes> => {
      const callId = ++latestCallIdRef.current;
      if (mountedRef.current) {
        setState((s) => (s.loading ? s : { ...s, loading: true }));
      }
      try {
        const res = await client.request<TRes>({
          ...initRef.current,
          ...override,
          body,
        });
        if (mountedRef.current && callId === latestCallIdRef.current) {
          setState({ data: res.body, error: undefined, loading: false });
        }
        return res.body;
      } catch (err) {
        const httpErr = toHttpError(err);
        if (mountedRef.current && callId === latestCallIdRef.current) {
          setState({ data: undefined, error: httpErr, loading: false });
        }
        throw httpErr;
      }
    },
    [client],
  );
  // fire-and-forget 版
  const mutate = useCallback(
    (body: TBody, override?: Partial<HttpRequestInit>): void => {
      mutateAsync(body, override).catch((err: unknown) => {
        // process.env を globalThis 経由で安全に参照
        const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
          .process?.env;
        if (env !== undefined && env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn(
            "[useHttpMutation] mutate error (use mutateAsync to handle):",
            err,
          );
        }
      });
    },
    [mutateAsync],
  );
  const reset = useCallback(() => {
    setState({ data: undefined, error: undefined, loading: false });
  }, []);
  return { ...state, mutate, mutateAsync, reset };
}
