// 公開型を取り込み
import type { AppErrorKind } from "./types.js";

// HTTP ステータスコードから AppErrorKind を決定する
export function classifyHttpStatus(status: number): AppErrorKind {
  // 0 は fetch が DNS / コネクション失敗時に返す値（ネットワーク到達不可）
  if (status === 0) {
    return "network";
  }
  // タイムアウト系
  if (status === 408 || status === 504) {
    return "timeout";
  }
  // バリデーション系（400 Bad Request / 422 Unprocessable Entity）
  if (status === 400 || status === 422) {
    return "validation";
  }
  // 認証エラー
  if (status === 401) {
    return "auth";
  }
  // 認可エラー
  if (status === 403) {
    return "permission";
  }
  // リソース未検出
  if (status === 404) {
    return "notFound";
  }
  // 競合（409 Conflict / 412 Precondition Failed）
  if (status === 409 || status === 412) {
    return "conflict";
  }
  // 5xx は system 障害として扱う
  if (status >= 500) {
    return "system";
  }
  // それ以外は HTTP 一般エラーへフォールバック
  return "http";
}

// code 文字列を小文字化＋区切り文字 (`_` / `-` / 空白) で分割した token Set を返すヘルパ
// 部分文字列マッチ（例: "AUTHOR_NAME" を auth と誤分類）を防ぐため、
// 以降の判定は完全一致 (Set#has) で行う
function tokenize(code: string): Set<string> {
  // 小文字化してから記号で分割
  const parts = code.toLowerCase().split(/[_\-\s]+/);
  // 空 token を除外して Set に詰める
  return new Set(parts.filter((part) => part.length > 0));
}

// エラーコード文字列から AppErrorKind を推定する（未分類は undefined を返す）
// token 完全一致で判定し、誤分類（"AUTHOR_NAME" → auth 等）を防ぐ
export function classifyErrorCode(code: string | undefined): AppErrorKind | undefined {
  // 未指定 code は分類できない
  if (code === undefined) {
    return undefined;
  }
  // code を token 集合に正規化
  const tokens = tokenize(code);
  // タイムアウト系 token（"timeout" / "etimedout" 単独完全一致）
  if (tokens.has("timeout") || tokens.has("etimedout")) {
    return "timeout";
  }
  // 通信系 token（"network" / Node 系 ECONN/ENOTFOUND 単独完全一致）
  if (tokens.has("network") || tokens.has("econnrefused") || tokens.has("enotfound")) {
    return "network";
  }
  // 検証系 token（"validation" / "invalid"）
  if (tokens.has("validation") || tokens.has("invalid")) {
    return "validation";
  }
  // 認証系 token（"auth" / "unauthorized" / "unauthenticated"）
  if (tokens.has("auth") || tokens.has("unauthorized") || tokens.has("unauthenticated")) {
    return "auth";
  }
  // 認可系 token（"permission" / "forbidden"）
  if (tokens.has("permission") || tokens.has("forbidden")) {
    return "permission";
  }
  // 競合系 token（"conflict" / "conflicted"）
  if (tokens.has("conflict") || tokens.has("conflicted")) {
    return "conflict";
  }
  // 未検出系 token（"notfound" 単独、または "not" + "found" の組み合わせ）
  if (tokens.has("notfound") || (tokens.has("not") && tokens.has("found"))) {
    return "notFound";
  }
  // どれにも該当しなければ呼び出し側で defaultKind を使ってもらう
  return undefined;
}
