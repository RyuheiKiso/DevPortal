// REST ヘルパで使う URL 周りのユーティリティ
import type { HttpRequestInit } from "../types.js";

// HttpRequestInit.query を URL クエリ文字列にエンコード（先頭 ? 込み、無ければ空文字）
// client.ts と同等ロジックを公開 API として外出し
export function encodeSearchParams(query: HttpRequestInit["query"]): string {
  // クエリが無ければ空文字
  if (query === undefined) {
    return "";
  }
  // URLSearchParams で順序を維持しつつエンコード
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // null / undefined はキーごとスキップ
    if (value === null || value === undefined) {
      continue;
    }
    // 配列値は要素ごとに append（key=v1&key=v2 形式）
    if (Array.isArray(value)) {
      for (const v of value) {
        params.append(key, String(v));
      }
      continue;
    }
    // プリミティブは文字列化して 1 件 append
    params.append(key, String(value));
  }
  const s = params.toString();
  return s.length > 0 ? `?${s}` : "";
}

// baseUrl と path を連結（path が絶対 URL なら素通し）
export function joinUrl(baseUrl: string | undefined, path: string): string {
  // 絶対 URL（http(s)://...）は素通し
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  // baseUrl 無指定は path をそのまま返す
  if (baseUrl === undefined || baseUrl.length === 0) {
    return path;
  }
  // スラッシュ重複を吸収して連結
  const left = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const right = path.startsWith("/") ? path : `/${path}`;
  return `${left}${right}`;
}
