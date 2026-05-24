// React の hook を取り込み
import { useContext, useRef } from "react";
// HTTP クライアント型を core から取り込み
import type { HttpClient, HttpClientConfig } from "@k1s0-ts-http/core";
// Context を取り込み
import { HttpClientContext } from "./context.js";

// Context から HttpClient を取り出す。Provider 外で呼ばれた場合は明示エラー
export function useHttpClient(): HttpClient {
  // Context 値を取得
  const client = useContext(HttpClientContext);
  // Provider が無いときは即エラー（実装ミスを早期発見）
  if (client === null) {
    throw new Error("useHttpClient must be called inside <HttpClientProvider>");
  }
  return client;
}

// useScopedHttpClient の override で受け付けるフィールド（A11/A12 対応）
// 関数フィールド (auth/logger/fetchImpl/interceptors) は構造比較できないため除外し、別 API で扱う
// 利用者が auth/interceptor を切り替えたい場合は親クライアントを withConfig して Provider に渡すべき
export type ScopedHttpOverride = Pick<
  HttpClientConfig,
  "baseUrl" | "defaultHeaders" | "retry" | "timeout"
>;

// 値の浅い等価判定（プリミティブ前提、ネストは Object.is で比較）
function shallowEqual<T extends Record<string, unknown>>(
  a: T | undefined,
  b: T | undefined,
): boolean {
  // 両方 undefined なら等価
  if (a === b) return true;
  // 片方だけ undefined なら不一致
  if (a === undefined || b === undefined) return false;
  // キー集合の長さが違えば不一致
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

// number[] / string[] 等の配列要素比較
function arrayEqual<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

// RetryPolicy 部分指定の構造比較（関数フィールドは無視、配列は要素比較）
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
  // shouldRetry / random は関数フィールドのため比較対象外（参照同一性を信頼）
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

// override の値部分を構造比較するキャッシュ
interface ScopedCache {
  // 親クライアント参照
  parent: HttpClient;
  // 前回の override 値
  override: ScopedHttpOverride;
  // 派生クライアント
  child: HttpClient;
}

// 親 HttpClient に部分的な設定上書きを加えた派生クライアントを取得
// 構造比較で安定化させ、毎レンダで新しいクライアントが作られないようにする
// override は ScopedHttpOverride に限定（A11/A12: auth/logger/interceptors は受け付けない）
export function useScopedHttpClient(override: ScopedHttpOverride): HttpClient {
  // 親クライアントを取得
  const parent = useHttpClient();
  // 前回のキャッシュを保持する ref
  const cacheRef = useRef<ScopedCache | null>(null);
  // 変化があれば withConfig 再生成
  if (
    cacheRef.current === null ||
    cacheRef.current.parent !== parent ||
    cacheRef.current.override.baseUrl !== override.baseUrl ||
    !shallowEqual(cacheRef.current.override.defaultHeaders, override.defaultHeaders) ||
    !retryEqual(cacheRef.current.override.retry, override.retry) ||
    !timeoutEqual(cacheRef.current.override.timeout, override.timeout)
  ) {
    // 派生クライアントを生成してキャッシュに保存
    cacheRef.current = {
      parent,
      override,
      child: parent.withConfig(override),
    };
  }
  return cacheRef.current.child;
}
