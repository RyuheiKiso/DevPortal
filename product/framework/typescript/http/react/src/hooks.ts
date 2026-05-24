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

// 1 オブジェクトの浅い等価判定（プリミティブ前提、ネストは Object.is で比較）
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

// override の値部分（参照同一性が壊れやすい defaultHeaders / retry / timeout / baseUrl）を構造比較するキャッシュ
interface ScopedCache {
  // 親クライアント参照
  parent: HttpClient;
  // 前回の baseUrl
  baseUrl: string | undefined;
  // 前回の defaultHeaders（参照比較ではなく内容比較）
  defaultHeaders: Record<string, string> | undefined;
  // 前回の retry
  retry: Partial<HttpClientConfig["retry"]>;
  // 前回の timeout
  timeout: HttpClientConfig["timeout"];
  // 派生クライアント
  child: HttpClient;
}

// 親 HttpClient に部分的な設定上書きを加えた派生クライアントを取得
// 構造比較で安定化させ、毎レンダで新しいクライアントが作られないようにする
export function useScopedHttpClient(
  override: Partial<HttpClientConfig>,
): HttpClient {
  // 親クライアントを取得
  const parent = useHttpClient();
  // 前回のキャッシュを保持する ref
  const cacheRef = useRef<ScopedCache | null>(null);
  // 比較対象の値を取り出し（関数フィールド等は参照同一性を信頼する）
  const baseUrl = override.baseUrl;
  const defaultHeaders = override.defaultHeaders;
  const retry = override.retry;
  const timeout = override.timeout;
  // 変化があれば withConfig 再生成
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
    // 派生クライアントを生成してキャッシュに保存
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
