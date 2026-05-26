// React の hook を取り込み
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// HTTP クライアント関連の型と HttpError を core から取り込み
import { HttpError, isJsonContentType } from "@k1s0-ts-http/core";
import type { HttpRequestInit, HttpResponse } from "@k1s0-ts-http/core";
// 親クライアント取得
import { useHttpClient } from "./hooks.js";

export type HttpResponseBodyMode =
  | "auto"
  | "json"
  | "text"
  | "blob"
  | "arrayBuffer"
  | "stream";

async function resolveJsonBody<T>(res: HttpResponse<T>): Promise<T> {
  const text = await res.raw.text();
  return (text.length > 0 ? JSON.parse(text) : undefined) as T;
}

async function resolveResponseBody<T>(
  res: HttpResponse<T>,
  mode: HttpResponseBodyMode = "auto",
): Promise<T> {
  try {
    if (res.body !== undefined) {
      return res.body;
    }

    if (mode === "json") {
      return await resolveJsonBody(res);
    }
    if (mode === "text") {
      const text = await res.raw.text();
      return (text.length > 0 ? text : undefined) as T;
    }
    if (mode === "blob") {
      return (await res.raw.blob()) as T;
    }
    if (mode === "arrayBuffer") {
      return (await res.raw.arrayBuffer()) as T;
    }
    if (mode === "stream") {
      return res.raw.body as T;
    }

    const contentType = res.headers["content-type"];
    if (isJsonContentType(contentType)) {
      return await resolveJsonBody(res);
    }

    const text = await res.raw.text();
    return (text.length > 0 ? text : undefined) as T;
  } catch (cause) {
    throw new HttpError({
      message: cause instanceof Error ? cause.message : "failed to parse response body",
      code: "PARSE_ERROR",
      retryable: false,
      requestId: res.request.requestId,
      response: res,
      cause,
    });
  }
}

// 任意の throw 値を HttpError にラップ（duck-typing 解消、B-14）
function toHttpError(err: unknown): HttpError {
  // 既に HttpError ならそのまま
  if (err instanceof HttpError) return err;
  // Error 派生はメッセージと cause を引き継ぐ
  if (err instanceof Error) {
    return new HttpError({
      message: err.message,
      code: "UNKNOWN",
      retryable: false,
      cause: err,
    });
  }
  // プリミティブは String 化（null/undefined も含む）
  return new HttpError({
    message: `non-Error thrown: ${String(err)}`,
    code: "UNKNOWN",
    retryable: false,
    cause: err,
  });
}

// useHttpQuery のオプション（B-10）
export interface HttpQueryOptions {
  // 依存配列（変化で再 fetch、既定 []）
  deps?: readonly unknown[];
  // false の間は fetch しない（loading: false / data: undefined を返し、enabled=true への遷移で自動 fetch、既定 true）
  enabled?: boolean;
  // レスポンス body の解釈方法。auto は JSON content-type なら JSON、それ以外は text
  parseAs?: HttpResponseBodyMode;
}

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
  // 強制再 fetch（Promise を返す、await して完了/失敗を待てる、B-15）
  refetch: () => Promise<void>;
}

// 軽量な GET 等の問い合わせ Hook
// init は ref で常に最新を参照（A7 対応の継続）
// 再 fetch トリガーは options.deps（既定 []）。options.enabled=false の間は実行しない
export function useHttpQuery<T = unknown>(
  init: HttpRequestInit,
  options: HttpQueryOptions = {},
): HttpQueryState<T> {
  // 親クライアントを取得
  const client = useHttpClient();
  // enabled の解決（既定 true）
  const enabled = options.enabled ?? true;
  const parseAs = options.parseAs ?? "auto";
  // 状態保持（enabled=false なら初期 loading=false）
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
  // 直前の AbortController を保持（再 fetch 時に abort するため）
  const ctrlRef = useRef<AbortController | null>(null);
  // 最新 init を ref に保存（stale closure 防止）
  const initRef = useRef(init);
  initRef.current = init;
  // fetch 実行ヘルパ（Promise を返す、B-15）
  // enabled / deps を useCallback の依存に含めることで、変化時に useEffect が再実行される（R-A3）
  const deps = options.deps;
  // useCallback の依存配列に deps を直接 spread すると、レンダ毎に長さが変動した場合
  // hooks ルール違反 (依存配列の長さ変動) でクラッシュする。
  // deps を useMemo で安定化し、固定長の依存配列を保持する。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const depsKey = useMemo(() => deps, deps ?? []);
  const fetchOnce = useCallback((): Promise<void> => {
    // 前回の request を abort
    ctrlRef.current?.abort();
    // enabled=false なら fetch しない（loading 状態は変更不要なら setState skip、R-A2）
    if (!enabled) {
      ctrlRef.current = null;
      // 既に loading=false なら setState を skip（不要な再 render を防ぐ）
      setState((s) => (s.loading ? { ...s, loading: false } : s));
      return Promise.resolve();
    }
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    // loading 状態へ
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    // 実行（最新 init を ref から取得）
    return client
      .request<T>({ ...initRef.current, signal: ctrl.signal })
      .then(async (res) => {
        // unmount 後の状態更新を避ける（abort 済みなら無視）
        if (ctrl.signal.aborted) return;
        const body = await resolveResponseBody(res, parseAs);
        if (ctrl.signal.aborted) return;
        setState({
          data: body,
          error: undefined,
          loading: false,
          requestId: res.request.requestId,
        });
      })
      .catch((err: unknown) => {
        // abort 後の catch も無視（race 防止）
        if (ctrl.signal.aborted) return;
        // HttpError にラップしてから判定（B-14）
        const httpErr = toHttpError(err);
        // ABORTED は次回 fetch による意図的中断なので state は更新しない
        if (httpErr.code === "ABORTED") return;
        setState({
          data: undefined,
          error: httpErr,
          loading: false,
          requestId: httpErr.requestId,
        });
      });
    // depsKey は useMemo で deps の内容変化を反映する単一参照キー (固定長 deps を維持)
  }, [client, enabled, parseAs, depsKey]);
  // 依存変化で fetch（unmount 時は abort）
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
  // 直近の成功データ
  data: TRes | undefined;
  // 直近のエラー
  error: HttpError | undefined;
  // 実行中フラグ
  loading: boolean;
  // fire-and-forget 実行（throw しない、エラーは state.error から取得、B-13）
  mutate: (body: TBody, override?: Partial<HttpRequestInit>) => void;
  // 実行（throw する、await して結果を受け取る、B-13）
  mutateAsync: (body: TBody, override?: Partial<HttpRequestInit>) => Promise<TRes>;
  // 状態をリセット
  reset: () => void;
}

export interface HttpMutationOptions {
  // レスポンス body の解釈方法。auto は JSON content-type なら JSON、それ以外は text
  parseAs?: HttpResponseBodyMode;
}

/**
 * POST 等の変更操作 Hook（B-13 で mutate / mutateAsync を分離）
 *
 * 注意（R-A4）:
 * - TBody は fetch の `BodyInit` 互換が必須（string / FormData / Blob / URLSearchParams / ArrayBuffer / ReadableStream）
 * - JSON を送りたい場合は呼び出し側で `JSON.stringify` し、`headers: { "Content-Type": "application/json" }` を指定
 * - もしくは core の `post(client, url, body, init)` ヘルパを使う（自動 JSON stringify）
 *
 * Race 防止（R-A1）: 連続 mutate 時は最後の呼び出しのみが state に反映される
 */
export function useHttpMutation<TBody extends BodyInit | null | undefined = BodyInit, TRes = unknown>(
  init: Omit<HttpRequestInit, "body">,
  options: HttpMutationOptions = {},
): HttpMutationState<TBody, TRes> {
  // 親クライアントを取得
  const client = useHttpClient();
  const parseAs = options.parseAs ?? "auto";
  // 状態保持
  const [state, setState] = useState<{
    data: TRes | undefined;
    error: HttpError | undefined;
    loading: boolean;
  }>({ data: undefined, error: undefined, loading: false });
  // mounted ref（unmount 後の state 更新を避ける）
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // 最新 init を ref に保存（A8、依存配列から除外）
  const initRef = useRef(init);
  initRef.current = init;
  // 最新呼び出し ID（R-A1: race 防止用、自分が最新でない呼び出しは state を更新しない）
  const latestCallIdRef = useRef(0);
  // 実体（throw する側、B-13）
  const mutateAsync = useCallback(
    async (body: TBody, override?: Partial<HttpRequestInit>): Promise<TRes> => {
      // 自分の呼び出し ID を確保（連打時に最後の呼び出しのみ state 更新を許す）
      const callId = ++latestCallIdRef.current;
      // loading 状態へ（既に true なら skip）
      if (mountedRef.current) {
        setState((s) => (s.loading ? s : { ...s, loading: true }));
      }
      try {
        // 実行（最新 init と override を合成）
        const res = await client.request<TRes>({
          ...initRef.current,
          ...override,
          body,
        });
        const responseBody = await resolveResponseBody(res, parseAs);
        // unmount 後 or 自分より新しい呼び出しが既に走っている場合は state 更新を skip
        if (mountedRef.current && callId === latestCallIdRef.current) {
          setState({ data: responseBody, error: undefined, loading: false });
        }
        return responseBody;
      } catch (err) {
        // HttpError にラップしてから state 更新（B-14）
        const httpErr = toHttpError(err);
        if (mountedRef.current && callId === latestCallIdRef.current) {
          setState({ data: undefined, error: httpErr, loading: false });
        }
        throw httpErr;
      }
    },
    [client, parseAs],
  );
  // fire-and-forget 版（throw しない、エラーは state 経由）
  const mutate = useCallback(
    (body: TBody, override?: Partial<HttpRequestInit>): void => {
      // dev 環境では mutate のエラーを console.warn で通知（unhandled rejection 監視の代替）
      mutateAsync(body, override).catch((err: unknown) => {
        // process.env を globalThis 経由で安全に参照（@types/node 非依存）
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
  // リセット関数
  const reset = useCallback(() => {
    setState({ data: undefined, error: undefined, loading: false });
  }, []);
  return { ...state, mutate, mutateAsync, reset };
}
