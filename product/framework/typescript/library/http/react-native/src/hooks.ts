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

// useScopedHttpClient の override で受け付けるフィールド（A11/A12 対応、react と同型）
export type ScopedHttpOverride = Pick<
  HttpClientConfig,
  "baseUrl" | "defaultHeaders" | "retry" | "timeout"
>;

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

// 配列要素比較
function arrayEqual<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

// RetryPolicy 部分指定の構造比較（関数フィールド shouldRetry/random は参照同一性を信頼）
function retryEqual(
  a: HttpClientConfig["retry"] | undefined,
  b: HttpClientConfig["retry"] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.maxRetries !== b.maxRetries) return false;
  if (a.backoffBaseMs !== b.backoffBaseMs) return false;
  if (a.backoffMaxMs !== b.backoffMaxMs) return false;
  if (a.jitter !== b.jitter) return false;
  if (!arrayEqual(a.retryableStatuses, b.retryableStatuses)) return false;
  return true;
}

// TimeoutPolicy の比較（プリミティブのみ）
function timeoutEqual(
  a: HttpClientConfig["timeout"] | undefined,
  b: HttpClientConfig["timeout"] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.totalMs === b.totalMs && a.perAttemptMs === b.perAttemptMs;
}

// useScopedHttpClient 用キャッシュ
interface ScopedCache {
  parent: HttpClient;
  override: ScopedHttpOverride;
  child: HttpClient;
}

// 親 HttpClient に設定を上書きした派生クライアントを取得（react 版と同実装）
// override は ScopedHttpOverride に限定（A11/A12: auth/logger/interceptors は受け付けない）
export function useScopedHttpClient(override: ScopedHttpOverride): HttpClient {
  const parent = useHttpClient();
  const cacheRef = useRef<ScopedCache | null>(null);
  // キャッシュ無効化判定
  if (
    cacheRef.current === null ||
    cacheRef.current.parent !== parent ||
    cacheRef.current.override.baseUrl !== override.baseUrl ||
    !shallowEqual(cacheRef.current.override.defaultHeaders, override.defaultHeaders) ||
    !retryEqual(cacheRef.current.override.retry, override.retry) ||
    !timeoutEqual(cacheRef.current.override.timeout, override.timeout)
  ) {
    cacheRef.current = {
      parent,
      override,
      child: parent.withConfig(override),
    };
  }
  return cacheRef.current.child;
}
