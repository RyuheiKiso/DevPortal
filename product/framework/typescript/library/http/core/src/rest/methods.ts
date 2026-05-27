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

// 任意のヘッダ集合に Content-Type (大小無視) が含まれているかを判定するヘルパ
function hasContentTypeHeader(
  headers: Record<string, string> | undefined,
): boolean {
  // 未指定なら false
  if (headers === undefined) return false;
  // 全キーを走査して "content-type" (小文字比較) があれば true
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === "content-type") return true;
  }
  return false;
}

// body を BodyInit に正規化し、ヘッダを更新する（JSON 自動 stringify + Content-Type 自動付与）
// defaultHeaders に Content-Type が既にある場合は auto 付与しない (利用者の設定を尊重する、M5)
function prepareBody(
  body: unknown,
  headers: Record<string, string> | undefined,
  defaultHeaders: Record<string, string> | undefined,
): { body: BodyInit | null | undefined; headers: Record<string, string> } {
  // 入力ヘッダのコピー（元を mutate しない）
  const outHeaders: Record<string, string> = { ...(headers ?? {}) };
  // body が JSON 化対象でなければ素通し（FormData/Blob/string 等）
  if (!isJsonSerializableBody(body)) {
    return { body: body as BodyInit | null | undefined, headers: outHeaders };
  }
  // Content-Type が init.headers / client.defaultHeaders の **どちらか** に既にあれば auto 付与しない
  // (defaultHeaders で text/plain 等を指定したケースを application/json で上書きしないため、M5)
  const hasContentType =
    hasContentTypeHeader(outHeaders) || hasContentTypeHeader(defaultHeaders);
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
  // body と headers を JSON 自動化処理 (client の defaultHeaders を参照して Content-Type 上書きを抑止)
  const prepared = prepareBody(body, init.headers, client.config.defaultHeaders);
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
  // body と headers を JSON 自動化処理 (client の defaultHeaders を参照して Content-Type 上書きを抑止)
  const prepared = prepareBody(body, init.headers, client.config.defaultHeaders);
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
  // body と headers を JSON 自動化処理 (client の defaultHeaders を参照して Content-Type 上書きを抑止)
  const prepared = prepareBody(body, init.headers, client.config.defaultHeaders);
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

/**
 * GET でテキストを取得（Content-Type に関わらず text() で読む、B-10）
 *
 * 副作用（C-A8/A9）:
 * - responseInterceptors が `res.body` を書き換えていた場合、その結果は破棄され
 *   `raw.text()` の結果で上書きされる
 * - 呼出後 `res.raw.body` は consume 済み（`res.raw.text()` 等の再呼び出しは TypeError）
 */
export async function getText(
  client: HttpClient,
  url: string,
  init: RestInit = {},
): Promise<HttpResponse<string>> {
  const res = await client.request<string>({ ...init, url, method: "GET" });
  // raw.text() で読む（既存 body は捨てて差し替え。以降 res.raw.body は consume 済み）
  const body = await res.raw.text();
  return { ...res, body };
}

/**
 * GET で Blob を取得（バイナリ・画像等）
 *
 * 副作用は getText と同じ（responseInterceptors の body を上書き、raw 再 consume 不可）
 */
export async function getBlob(
  client: HttpClient,
  url: string,
  init: RestInit = {},
): Promise<HttpResponse<Blob>> {
  const res = await client.request<Blob>({ ...init, url, method: "GET" });
  const body = await res.raw.blob();
  return { ...res, body };
}

/**
 * GET で ArrayBuffer を取得（バイナリ）
 *
 * 副作用は getText と同じ（responseInterceptors の body を上書き、raw 再 consume 不可）
 */
export async function getArrayBuffer(
  client: HttpClient,
  url: string,
  init: RestInit = {},
): Promise<HttpResponse<ArrayBuffer>> {
  const res = await client.request<ArrayBuffer>({
    ...init,
    url,
    method: "GET",
  });
  const body = await res.raw.arrayBuffer();
  return { ...res, body };
}

/**
 * GET で JSON を強制 parse（Content-Type に関わらず JSON.parse、空ボディは undefined）
 *
 * 注意: 戻り型 `T` に対し空ボディ時は `undefined` を返す。利用側で nullable な型 (`T | undefined`)
 * として受けるか、空応答を期待しない API でのみ使うこと。`""` や空白のみの本文は SyntaxError を投げる
 *
 * 副作用は getText と同じ（responseInterceptors の body を上書き、raw 再 consume 不可）
 */
export async function getJson<T = unknown>(
  client: HttpClient,
  url: string,
  init: RestInit = {},
): Promise<HttpResponse<T>> {
  const res = await client.request<T>({ ...init, url, method: "GET" });
  const text = await res.raw.text();
  const body = (text.length > 0 ? JSON.parse(text) : undefined) as T;
  return { ...res, body };
}
