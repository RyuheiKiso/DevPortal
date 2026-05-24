// REST ヘルパ：型付き get/post/put/patch/del を提供
import type {
  HttpClient,
  HttpRequestInit,
  HttpResponse,
} from "../types.js";
import { isJsonContentType, isJsonSerializableBody } from "./json.js";

// 共通の init 型（url/method/body を除外したオプション）
export type RestInit = Omit<HttpRequestInit, "url" | "method" | "body">;

// body 付き init 型（POST/PUT/PATCH 用）
type BodyfulInit = Omit<HttpRequestInit, "url" | "method">;

// レスポンス body を Content-Type に応じてパースし、HttpResponse<T> に格納する
async function parseResponseBody<T>(res: HttpResponse): Promise<HttpResponse<T>> {
  // Content-Type ヘッダ（小文字キー想定）
  const contentType = res.headers["content-type"];
  // JSON 系なら text を読み取って JSON.parse、それ以外は body 未パースのまま型キャスト
  if (isJsonContentType(contentType)) {
    // 空ボディも考慮（204 / 205 等）
    const text = await res.raw.text();
    // 空文字列なら undefined を返す（パース失敗を避ける）
    const parsed: unknown = text.length > 0 ? JSON.parse(text) : undefined;
    return { ...res, body: parsed as T };
  }
  // JSON でないなら raw.body をそのまま型キャストして返す
  return { ...res, body: res.raw.body as unknown as T };
}

// body を BodyInit に正規化し、ヘッダを更新する（JSON 自動 stringify + Content-Type 自動付与）
function prepareBody(
  body: unknown,
  headers: Record<string, string> | undefined,
): { body: BodyInit | null | undefined; headers: Record<string, string> } {
  // 入力ヘッダのコピー（元を mutate しない）
  const outHeaders: Record<string, string> = { ...(headers ?? {}) };
  // body が JSON 化対象でなければ素通し（FormData/Blob/string 等）
  if (!isJsonSerializableBody(body)) {
    return { body: body as BodyInit | null | undefined, headers: outHeaders };
  }
  // Content-Type が既に指定されている場合は尊重（大文字小文字どちらも検出）
  const hasContentType = Object.keys(outHeaders).some(
    (k) => k.toLowerCase() === "content-type",
  );
  // 未指定なら application/json を自動付与
  if (!hasContentType) {
    outHeaders["Content-Type"] = "application/json";
  }
  // JSON 化して返す
  return { body: JSON.stringify(body), headers: outHeaders };
}

// GET
export async function get<T = unknown>(
  client: HttpClient,
  url: string,
  init: RestInit = {},
): Promise<HttpResponse<T>> {
  // method を GET に固定して低レベル request を呼び出し
  const res = await client.request<T>({ ...init, url, method: "GET" });
  // レスポンスを JSON parse して返す
  return parseResponseBody<T>(res);
}

// POST
export async function post<T = unknown>(
  client: HttpClient,
  url: string,
  body?: unknown,
  init: BodyfulInit = {},
): Promise<HttpResponse<T>> {
  // body と headers を JSON 自動化処理
  const prepared = prepareBody(body, init.headers);
  // method を POST に固定して低レベル request を呼び出し
  const res = await client.request<T>({
    ...init,
    url,
    method: "POST",
    headers: prepared.headers,
    body: prepared.body,
  });
  return parseResponseBody<T>(res);
}

// PUT
export async function put<T = unknown>(
  client: HttpClient,
  url: string,
  body?: unknown,
  init: BodyfulInit = {},
): Promise<HttpResponse<T>> {
  const prepared = prepareBody(body, init.headers);
  const res = await client.request<T>({
    ...init,
    url,
    method: "PUT",
    headers: prepared.headers,
    body: prepared.body,
  });
  return parseResponseBody<T>(res);
}

// PATCH
export async function patch<T = unknown>(
  client: HttpClient,
  url: string,
  body?: unknown,
  init: BodyfulInit = {},
): Promise<HttpResponse<T>> {
  const prepared = prepareBody(body, init.headers);
  const res = await client.request<T>({
    ...init,
    url,
    method: "PATCH",
    headers: prepared.headers,
    body: prepared.body,
  });
  return parseResponseBody<T>(res);
}

// DELETE（"delete" は予約語のため "del" として公開）
export async function del<T = unknown>(
  client: HttpClient,
  url: string,
  init: RestInit = {},
): Promise<HttpResponse<T>> {
  const res = await client.request<T>({ ...init, url, method: "DELETE" });
  return parseResponseBody<T>(res);
}
