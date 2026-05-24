// client が利用する各種ユーティリティ／型を取り込み
import type {
  HttpClient,
  HttpClientConfig,
  HttpRequest,
  HttpRequestInit,
  HttpResponse,
  HttpMethod,
} from "./types.js";
import { HttpError, normalizeError } from "./errors.js";
import {
  runErrorInterceptors,
  runRequestInterceptors,
  runResponseInterceptors,
} from "./interceptors.js";
import { noopLogger } from "./logging.js";
import { REQUEST_ID_HEADER, createRequestId } from "./requestId.js";
import { mergeRetryDefaults, withRetry } from "./retry.js";
import { withTimeout } from "./timeout.js";

// 平坦化された Response.headers を Record<string,string> に変換
function headersToObject(headers: Headers): Record<string, string> {
  // forEach で 1 件ずつ拾い、小文字キーに統一
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

// baseUrl と path を連結する（path が絶対 URL なら素通し）
function joinUrl(baseUrl: string | undefined, path: string): string {
  // 絶対 URL（http:// or https://）はそのまま返す
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  // baseUrl が無い場合は path をそのまま返す（呼出側責務）
  if (baseUrl === undefined || baseUrl.length === 0) {
    return path;
  }
  // 末尾スラッシュと先頭スラッシュの重複を吸収して連結
  const left = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const right = path.startsWith("/") ? path : `/${path}`;
  return `${left}${right}`;
}

// HttpRequestInit.query を URL クエリ文字列にエンコードする
function encodeSearchParams(query: HttpRequestInit["query"]): string {
  // クエリが無ければ空文字
  if (query === undefined) {
    return "";
  }
  // URLSearchParams に詰める（配列値は複数回 append で展開、null/undefined はスキップ）
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // null / undefined はキー自体を出力しない
    if (value === null || value === undefined) {
      continue;
    }
    // 配列値は要素ごとに append（key=v1&key=v2）
    if (Array.isArray(value)) {
      for (const v of value) {
        params.append(key, String(v));
      }
      continue;
    }
    // プリミティブ値は文字列化して append
    params.append(key, String(value));
  }
  // 1 件以上あれば ? プレフィックス付きで返す（無ければ空文字）
  const s = params.toString();
  return s.length > 0 ? `?${s}` : "";
}

// 2 つの設定を浅マージするヘルパ（withConfig 用）
function mergeConfig(
  base: HttpClientConfig,
  override: Partial<HttpClientConfig>,
): HttpClientConfig {
  return {
    // ベース URL は override 優先
    baseUrl: override.baseUrl ?? base.baseUrl,
    // ヘッダは深マージ（後勝ち）
    defaultHeaders: {
      ...(base.defaultHeaders ?? {}),
      ...(override.defaultHeaders ?? {}),
    },
    // auth / logger / fetchImpl / generateRequestId は単純差し替え
    auth: override.auth ?? base.auth,
    logger: override.logger ?? base.logger,
    fetchImpl: override.fetchImpl ?? base.fetchImpl,
    generateRequestId: override.generateRequestId ?? base.generateRequestId,
    // retry は部分指定の浅マージ
    retry: { ...(base.retry ?? {}), ...(override.retry ?? {}) },
    // timeout も浅マージ
    timeout: { ...(base.timeout ?? {}), ...(override.timeout ?? {}) },
    // interceptor 群は配列連結（base → override の順で追加）
    requestInterceptors: [
      ...(base.requestInterceptors ?? []),
      ...(override.requestInterceptors ?? []),
    ],
    responseInterceptors: [
      ...(base.responseInterceptors ?? []),
      ...(override.responseInterceptors ?? []),
    ],
    errorInterceptors: [
      ...(base.errorInterceptors ?? []),
      ...(override.errorInterceptors ?? []),
    ],
  };
}

// HTTP クライアントを生成するファクトリ
export function createHttpClient(config: HttpClientConfig = {}): HttpClient {
  // fetch 実装の解決（globalThis.fetch は環境差で undefined のことがあるので bind を行わず参照のみ）
  const fetchImpl: typeof fetch =
    config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  // logger（未指定時は no-op）
  const logger = config.logger ?? noopLogger;
  // requestId 生成関数（未指定時は組み込みの createRequestId）
  const generateRequestId = config.generateRequestId ?? createRequestId;
  // retry policy（既定値とマージして完成形に）
  const retryPolicy = mergeRetryDefaults(config.retry);
  // timeout（未指定時は空オブジェクト）
  const timeout = config.timeout ?? {};
  // interceptor 群（未指定時は空配列）
  const reqInts = config.requestInterceptors ?? [];
  const resInts = config.responseInterceptors ?? [];
  const errInts = config.errorInterceptors ?? [];

  // request 本体（型引数 T はレスポンスボディ型）
  async function request<T = unknown>(
    init: HttpRequestInit,
  ): Promise<HttpResponse<T>> {
    // [A] URL を組み立て（baseUrl + path + query）
    const url = joinUrl(config.baseUrl, init.url) + encodeSearchParams(init.query);
    // [B] HttpRequest 雛形（method 既定 GET / requestId 生成 / headers マージ）
    const method: HttpMethod = init.method ?? "GET";
    const mergedHeaders: Record<string, string> = {
      ...(config.defaultHeaders ?? {}),
      ...(init.headers ?? {}),
    };
    const requestId = generateRequestId();
    let req: HttpRequest = {
      url,
      method,
      headers: mergedHeaders,
      body: init.body,
      signal: init.signal,
      requestId,
      meta: init.meta,
    };

    // [C] auth ヘッダを追加（指定があれば）
    if (config.auth !== undefined) {
      const authHeaders = await config.auth.getAuthHeaders();
      req = { ...req, headers: { ...req.headers, ...authHeaders } };
    }

    // [D] X-Request-Id を必ず付与（auth より後）
    req.headers[REQUEST_ID_HEADER] = req.requestId;

    // [E] user の request interceptors を順次適用
    req = await runRequestInterceptors(req, reqInts);

    // [F] logger.debug でリクエスト開始を記録
    logger.debug("http.request", {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
    });

    try {
      // [G] withTimeout(total) で全体時間制限
      return await withTimeout(timeout.totalMs, req.signal, async (totalSignal) => {
        // [H] withRetry で attempt 群を制御
        return await withRetry(retryPolicy, totalSignal, async (attempt) => {
          // [I] withTimeout(perAttempt) で 1 試行ごとの時間制限
          return await withTimeout(timeout.perAttemptMs, totalSignal, async (signal) => {
            // [J] fetch 本体を呼び出し
            const raw = await fetchImpl(req.url, {
              method: req.method,
              headers: req.headers,
              body: req.body,
              signal,
            });
            // [K] !ok なら HttpError を throw（retry 判定対象に）
            if (!raw.ok) {
              const httpErr = new HttpError({
                message: `HTTP ${raw.status}`,
                status: raw.status,
                retryable: retryPolicy.retryableStatuses.includes(raw.status),
                requestId: req.requestId,
              });
              logger.warn("http.response.error", {
                requestId: req.requestId,
                status: raw.status,
                attempt,
              });
              throw httpErr;
            }
            // [L] ok なら HttpResponse を組み立て（body は未パースのまま raw 保持）
            let res: HttpResponse<T> = {
              status: raw.status,
              ok: true,
              headers: headersToObject(raw.headers),
              body: undefined as unknown as T,
              raw,
              request: req,
            };
            // [M] response interceptors を順次適用（型は HttpResponse<T> として戻す）
            res = (await runResponseInterceptors(res, resInts)) as HttpResponse<T>;
            // [N] logger.info で成功を記録
            logger.info("http.response", {
              requestId: req.requestId,
              status: raw.status,
              attempt,
            });
            return res;
          });
        });
      });
    } catch (raw) {
      // [O] エラーを HttpError に正規化
      const err = normalizeError(raw, req);
      // logger.error で失敗を記録
      logger.error("http.error", {
        requestId: req.requestId,
        code: err.code,
        status: err.status,
        message: err.message,
      });
      // error interceptors があれば順次適用（最終的に throw する責務、無ければ単純 throw）
      if (errInts.length > 0) await runErrorInterceptors(err, req, errInts);
      // ここに到達するのは errInts が空（or interceptor が throw を忘れた安全網）の場合のみ
      throw err;
    }
  }

  // withConfig: 部分上書きで派生クライアントを作成
  function withConfigOverride(override: Partial<HttpClientConfig>): HttpClient {
    return createHttpClient(mergeConfig(config, override));
  }

  // HttpClient インターフェース実装を返す（config は読み取り専用スナップショット）
  return {
    request,
    withConfig: withConfigOverride,
    config: Object.freeze({ ...config }),
  };
}
