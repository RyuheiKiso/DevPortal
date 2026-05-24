// React の hook を取り込み
import { useContext, useRef } from "react";
// HTTP クライアント型を core から取り込み
import type { HttpClient, HttpClientConfig } from "@k1s0-ts-http/core";
// Context を取り込み
import { HttpClientContext } from "./context.js";

// Context から HttpClient を取り出す（Provider 外なら明示エラー）
export function useHttpClient(): HttpClient {
  // Context 値を取得
  const client = useContext(HttpClientContext);
  // Provider が無いときは即エラー
  if (client === null) {
    throw new Error("useHttpClient must be called inside <HttpClientProvider>");
  }
  return client;
}

// オブジェクトの浅い等価判定
function shallowEqual<T extends Record<string, unknown>>(
  a: T | undefined,
  b: T | undefined,
): boolean {
  // 両方 undefined なら等価
  if (a === b) return true;
  // 片方だけ undefined なら不一致
  if (a === undefined || b === undefined) return false;
  // キー集合の長さ比較
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  // 各キーの値を Object.is で比較
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Object.is(a[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

// useScopedHttpClient 用キャッシュ
interface ScopedCache {
  parent: HttpClient;
  baseUrl: string | undefined;
  defaultHeaders: Record<string, string> | undefined;
  retry: Partial<HttpClientConfig["retry"]>;
  timeout: HttpClientConfig["timeout"];
  child: HttpClient;
}

// 親 HttpClient に設定を上書きした派生クライアントを取得（react 版と同実装）
export function useScopedHttpClient(
  override: Partial<HttpClientConfig>,
): HttpClient {
  const parent = useHttpClient();
  const cacheRef = useRef<ScopedCache | null>(null);
  const baseUrl = override.baseUrl;
  const defaultHeaders = override.defaultHeaders;
  const retry = override.retry;
  const timeout = override.timeout;
  // キャッシュ無効化判定
  if (
    cacheRef.current === null ||
    cacheRef.current.parent !== parent ||
    cacheRef.current.baseUrl !== baseUrl ||
    !shallowEqual(cacheRef.current.defaultHeaders, defaultHeaders) ||
    !shallowEqual(
      cacheRef.current.retry as Record<string, unknown> | undefined,
      retry as Record<string, unknown> | undefined,
    ) ||
    !shallowEqual(
      cacheRef.current.timeout as Record<string, unknown> | undefined,
      timeout as Record<string, unknown> | undefined,
    )
  ) {
    cacheRef.current = {
      parent,
      baseUrl,
      defaultHeaders,
      retry,
      timeout,
      child: parent.withConfig(override),
    };
  }
  return cacheRef.current.child;
}
