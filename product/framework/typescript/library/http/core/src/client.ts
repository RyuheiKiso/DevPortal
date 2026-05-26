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
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_METHODS,
  mergeRetryDefaults,
  withRetry,
} from "./retry.js";
import { appendSearchParams, joinUrl } from "./rest/url.js";
import { withTimeout } from "./timeout.js";

function assertNonNegativeInteger(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`HttpClientConfig.${name} must be a non-negative integer`);
  }
}

function validateRuntimeConfig(config: HttpClientConfig): void {
  if (config.requestIdHeader !== undefined && config.requestIdHeader.trim().length === 0) {
    throw new Error("HttpClientConfig.requestIdHeader must be a non-empty string");
  }

  assertNonNegativeInteger("retry.maxRetries", config.retry?.maxRetries);
  assertNonNegativeInteger("retry.backoffBaseMs", config.retry?.backoffBaseMs);
  assertNonNegativeInteger("retry.backoffMaxMs", config.retry?.backoffMaxMs);
  if (
    config.retry?.jitter !== undefined &&
    config.retry.jitter !== "full" &&
    config.retry.jitter !== "none"
  ) {
    throw new Error('HttpClientConfig.retry.jitter must be "full" or "none"');
  }
  if (
    config.retry?.retryableStatuses !== undefined &&
    !config.retry.retryableStatuses.every((status) => Number.isInteger(status))
  ) {
    throw new Error("HttpClientConfig.retry.retryableStatuses must contain only integers");
  }

  assertNonNegativeInteger("timeout.totalMs", config.timeout?.totalMs);
  assertNonNegativeInteger("timeout.perAttemptMs", config.timeout?.perAttemptMs);
}

// 平坦化された Response.headers を Record<string,string> に変換
function headersToObject(headers: Headers): Record<string, string> {
  // forEach で 1 件ずつ拾い、小文字キーに統一
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

// 任意個の headers (任意のキー大小文字) を case-insensitive にマージする
// 同名 (大小無視) のキーがあれば「後に来た定義」を採用し、最終的にユニークな出力にする
// HTTP ヘッダは RFC 7230 §3.2 で大小無視のため、`Authorization` と `authorization` の
// 両方が出力に含まれると一部サーバが 400 を返す事故が起きうる。これを構造的に防ぐ。
function mergeHeadersCaseInsensitive(
  ...sources: ReadonlyArray<Record<string, string> | undefined>
): Record<string, string> {
  // 小文字キー → { 元の大小文字キー名, 値 } のマップ
  const byLower = new Map<string, { name: string; value: string }>();
  // sources を順に走査 (後勝ち)
  for (const src of sources) {
    if (src === undefined) continue;
    for (const [k, v] of Object.entries(src)) {
      // 小文字キーで衝突判定
      byLower.set(k.toLowerCase(), { name: k, value: v });
    }
  }
  // 元のキー名 (後勝ちで採用) を保持したまま単一の Record として返却する
  const out: Record<string, string> = {};
  for (const { name, value } of byLower.values()) {
    out[name] = value;
  }
  return out;
}

// body が「1 度しか読めない」ものなら true（ReadableStream / consumed Body）
// retry を無効化すべきかの判定に使う（A5 対応）
function isConsumableBody(body: unknown): boolean {
  // 未指定は consume 不可ではない
  if (body === undefined || body === null) return false;
  // 文字列・Blob・ArrayBuffer・FormData・URLSearchParams は何度でも送れる
  if (typeof body === "string") return false;
  if (typeof FormData !== "undefined" && body instanceof FormData) return false;
  if (typeof Blob !== "undefined" && body instanceof Blob) return false;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return false;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return false;
  // ReadableStream は 1 度の読取で消費される → retry 不可
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return true;
  // それ以外は安全側で false（実害が出るならテストで顕在化）
  return false;
}

// リクエストが冪等的か（IDEMPOTENT_METHODS or Idempotency-Key ヘッダ付き、B-4）
// Idempotency-Key は client が受け取った req.headers のみを確認（auth ヘッダや response ヘッダは見ない）
// 大小無視（HTTP RFC 7230 §3.2）
function isIdempotentRequest(req: HttpRequest): boolean {
  if (IDEMPOTENT_METHODS.has(req.method)) return true;
  const lowerKey = IDEMPOTENCY_KEY_HEADER.toLowerCase();
  for (const k of Object.keys(req.headers)) {
    if (k.toLowerCase() === lowerKey) return true;
  }
  return false;
}

// retry を無効化すべき理由（debug ログ用、C-A4）
type RetryDisabledReason = "consumable-body" | "non-idempotent";

// effective な retry policy と無効化理由を返すヘルパ
// 優先順位: ReadableStream body > 冪等性ガード（allowNonIdempotent でオプトアウト可、C-A2）
function resolveEffectiveRetryPolicy(
  req: HttpRequest,
  basePolicy: ReturnType<typeof mergeRetryDefaults>,
): { policy: ReturnType<typeof mergeRetryDefaults>; disabledReason?: RetryDisabledReason } {
  // consumable body（ReadableStream 等）は retry 不可
  if (isConsumableBody(req.body)) {
    return {
      policy: { ...basePolicy, maxRetries: 0 },
      disabledReason: "consumable-body",
    };
  }
  // allowNonIdempotent: true なら冪等性ガードをスキップ（明示オプトイン、C-A2）
  if (basePolicy.allowNonIdempotent === true) {
    return { policy: basePolicy };
  }
  // 非冪等メソッド + Idempotency-Key 無し → retry 無効化（C-A2: shouldRetry 有無に関わらず常時適用）
  if (!isIdempotentRequest(req)) {
    return {
      policy: { ...basePolicy, maxRetries: 0 },
      disabledReason: "non-idempotent",
    };
  }
  // 冪等条件を満たせば既定 policy
  return { policy: basePolicy };
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

function snapshotConfig(config: HttpClientConfig): HttpClientConfig {
  return {
    ...config,
    defaultHeaders:
      config.defaultHeaders === undefined ? undefined : { ...config.defaultHeaders },
    retry: config.retry === undefined ? undefined : { ...config.retry },
    timeout: config.timeout === undefined ? undefined : { ...config.timeout },
    requestInterceptors:
      config.requestInterceptors === undefined
        ? undefined
        : [...config.requestInterceptors],
    responseInterceptors:
      config.responseInterceptors === undefined
        ? undefined
        : [...config.responseInterceptors],
    errorInterceptors:
      config.errorInterceptors === undefined ? undefined : [...config.errorInterceptors],
  };
}

function freezeConfigSnapshot(config: HttpClientConfig): Readonly<HttpClientConfig> {
  const snapshot = snapshotConfig(config);
  if (snapshot.defaultHeaders !== undefined) Object.freeze(snapshot.defaultHeaders);
  if (snapshot.retry !== undefined) Object.freeze(snapshot.retry);
  if (snapshot.timeout !== undefined) Object.freeze(snapshot.timeout);
  if (snapshot.requestInterceptors !== undefined) Object.freeze(snapshot.requestInterceptors);
  if (snapshot.responseInterceptors !== undefined) Object.freeze(snapshot.responseInterceptors);
  if (snapshot.errorInterceptors !== undefined) Object.freeze(snapshot.errorInterceptors);
  return Object.freeze(snapshot);
}

// HTTP クライアントを生成するファクトリ
export function createHttpClient(rawConfig: HttpClientConfig = {}): HttpClient {
  const config = snapshotConfig(rawConfig);
  // JS 利用や外部設定由来の不正値を入口で止める（負の retry などの無限ループ防止）
  validateRuntimeConfig(config);
  // fetch 実装の解決（globalThis.fetch は環境差で undefined のことがあるので bind を行わず参照のみ）
  const fetchImpl: typeof fetch =
    config.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  // logger（未指定時は no-op）
  const logger = config.logger ?? noopLogger;
  // requestId 生成関数（未指定時は組み込みの createRequestId）
  const generateRequestId = config.generateRequestId ?? createRequestId;
  // 相関 ID を載せるヘッダ名（B-2、既定 "X-Request-Id"、traceparent も可能）
  const requestIdHeader = config.requestIdHeader ?? REQUEST_ID_HEADER;
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
    const url = appendSearchParams(joinUrl(config.baseUrl, init.url), init.query);
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

    // [C] user の request interceptors を先に適用（ユーザが url/headers を変更できる）
    req = await runRequestInterceptors(req, reqInts);

    // [D] logger.debug でリクエスト開始を記録
    logger.debug("http.request", {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
    });

    // effective な retry policy を解決（ReadableStream / 冪等性ガード、A5/B-4/C-A2/C-A4）
    const resolved = resolveEffectiveRetryPolicy(req, retryPolicy);
    const effectiveRetryPolicy = resolved.policy;
    // 無効化された場合は理由を debug ログに（C-A4、本番調査支援）
    if (resolved.disabledReason !== undefined) {
      logger.debug("http.retry.disabled", {
        requestId: req.requestId,
        method: req.method,
        reason: resolved.disabledReason,
      });
    }

    try {
      // [E] withTimeout(total) で全体時間制限
      return await withTimeout(timeout.totalMs, req.signal, async (totalSignal) => {
        // [F] withRetry で attempt 群を制御
        return await withRetry(effectiveRetryPolicy, totalSignal, async (attempt) => {
          // [G] withTimeout(perAttempt) で 1 試行ごとの時間制限
          return await withTimeout(timeout.perAttemptMs, totalSignal, async (signal) => {
            // [H] attempt 毎に auth ヘッダを取得（token refresh 対応、A3）
            // ヘッダは case-insensitive にマージし、`Authorization` と `authorization` の重複を防ぐ
            // (一部サーバはヘッダ重複を 400 として弾くため、出力は必ずユニーク名にする)
            const authHeaders =
              config.auth !== undefined ? await config.auth.getAuthHeaders() : undefined;
            // [I] 相関 ID を最終的に付与（auth より後、interceptor の置換からも保護、A1）
            // ヘッダ名は config.requestIdHeader でカスタマイズ可能（既定 "X-Request-Id"、B-2）
            // mergeHeadersCaseInsensitive により req.headers + authHeaders + requestId が
            // すべて単一の名前 (大小無視で重複しない) で出力される
            const attemptHeaders = mergeHeadersCaseInsensitive(
              // ベース: ユーザ指定 + defaultHeaders マージ済みのリクエストヘッダ
              req.headers,
              // 認証ヘッダ (auth provider から都度取得、最新トークン反映)
              authHeaders,
              // 相関 ID は常に最後に上書きして確実に付与する
              { [requestIdHeader]: req.requestId },
            );
            // [J] fetch 本体を呼び出し、retry 層が判定できるよう fetch 由来の例外も正規化する
            let raw: Response;
            try {
              raw = await fetchImpl(req.url, {
                method: req.method,
                headers: attemptHeaders,
                body: req.body,
                signal,
              });
            } catch (err) {
              throw normalizeError(err, req);
            }
            // [K] !ok なら HttpError を throw（retry 判定対象に / response も保持、A2）
            if (!raw.ok) {
              // エラーレスポンスを HttpResponse として保持（利用者が err.response.raw.text() 等で読める）
              const errResponse: HttpResponse = {
                status: raw.status,
                ok: false,
                headers: headersToObject(raw.headers),
                rawHeaders: raw.headers,
                body: undefined,
                raw,
                request: req,
              };
              // retryable は effectivePolicy ベースで判定（冪等性ガードで実際に retry されない場合は false に、C-A1）
              const canRetryMore =
                attempt < effectiveRetryPolicy.maxRetries &&
                effectiveRetryPolicy.maxRetries > 0;
              // shouldRetry が定義されている場合は実際に評価して boolean を採用する
              // (旧実装は `shouldRetry !== undefined` のみで真扱いとしており、shouldRetry が
              //  false を返しても retryable=true になる不整合があった)
              // shouldRetry へは status / response 情報を持つ暫定 HttpError を渡す
              let willActuallyRetry = false;
              if (canRetryMore) {
                if (effectiveRetryPolicy.shouldRetry !== undefined) {
                  // shouldRetry 用に暫定 HttpError を生成 (retryable は判定結果に依存するため一旦 false)
                  const prelimErr = new HttpError({
                    message: `HTTP ${raw.status}`,
                    status: raw.status,
                    retryable: false,
                    requestId: req.requestId,
                    response: errResponse,
                  });
                  // shouldRetry 結果が厳密に true なら retry 確定
                  willActuallyRetry = effectiveRetryPolicy.shouldRetry(prelimErr, attempt) === true;
                } else {
                  // shouldRetry 未指定なら既定の retryableStatuses 判定
                  willActuallyRetry = effectiveRetryPolicy.retryableStatuses.includes(raw.status);
                }
              }
              const httpErr = new HttpError({
                message: `HTTP ${raw.status}`,
                status: raw.status,
                retryable: willActuallyRetry,
                requestId: req.requestId,
                response: errResponse,
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
              rawHeaders: raw.headers,
              body: undefined,
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
    config: freezeConfigSnapshot(config),
  };
}
