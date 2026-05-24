// gRPC クライアントファクトリ：grpc-web を動的 import で wrap し、auth / retry / timeout / log を統合
import { HttpError, normalizeError } from "../errors.js";
import { noopLogger } from "../logging.js";
import { REQUEST_ID_HEADER, createRequestId } from "../requestId.js";
import { mergeRetryDefaults, withRetry } from "../retry.js";
import { validateGrpcClientConfig } from "../schema.js";
import { withTimeout } from "../timeout.js";
import type {
  GrpcClient,
  GrpcClientConfig,
  GrpcMethodDescriptor,
  GrpcWebLikeClient,
} from "./types.js";
import { invokeUnary } from "./adapter.js";

// gRPC-web のモジュール形を抽象化（factory が未指定時の dynamic import 用）
interface GrpcWebModule {
  // 既定 GrpcWebClientBase（rpcCall を持つ）
  GrpcWebClientBase: new (options?: unknown) => GrpcWebLikeClient;
}

// grpc-web を動的 import で読み込む内部ヘルパ
// インストールされていない環境では明示的に HttpError を throw
async function loadGrpcWeb(): Promise<GrpcWebModule> {
  try {
    // 動的 import で peerDep を解決
    const mod = (await import("grpc-web")) as unknown as GrpcWebModule;
    return mod;
  } catch (cause) {
    // peerDep 未インストール時：core 全体を壊さず、呼び出し時にだけ明示エラー
    throw new HttpError({
      message:
        "grpc-web is not installed; add it as a peer dependency to use @k1s0-ts-http/core gRPC client",
      code: "GRPC_PEER_MISSING",
      retryable: false,
      cause,
    });
  }
}

// gRPC クライアントを生成（grpc-web の dynamic import を含むため async）
export async function createGrpcClient(
  config: GrpcClientConfig,
): Promise<GrpcClient> {
  // 設定値の早期 validate（baseUrl の空文字 / URL 不正を弾く、agent レビュー指摘）
  validateGrpcClientConfig({
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    retry: config.retry,
  });
  // 関数フィールドの duck-typing チェック（zod は関数を validate しないため、ここで早期検出、C-A10）
  if (config.auth !== undefined && typeof config.auth.getAuthHeaders !== "function") {
    throw new HttpError({
      message: "GrpcClientConfig.auth.getAuthHeaders must be a function",
      code: "INVALID_CONFIG",
      retryable: false,
    });
  }
  if (
    config.grpcClientFactory !== undefined &&
    typeof config.grpcClientFactory !== "function"
  ) {
    throw new HttpError({
      message: "GrpcClientConfig.grpcClientFactory must be a function",
      code: "INVALID_CONFIG",
      retryable: false,
    });
  }
  // logger 未指定時は no-op
  const logger = config.logger ?? noopLogger;
  // requestId 生成関数（未指定時は組み込み）
  const generateRequestId = config.generateRequestId ?? createRequestId;
  // retry policy を既定値とマージ
  const retryPolicy = mergeRetryDefaults(config.retry);

  // grpc-web Client の解決を遅延（unary 初回呼び出しまで dynamic import を走らせない、A13 対応）
  // factory 未指定なら createGrpcClient 段階では peerDep に触らないため、grpc を使わないアプリで副作用なし
  let underlying: GrpcWebLikeClient | undefined = undefined;
  const resolveUnderlying = async (): Promise<GrpcWebLikeClient> => {
    if (underlying !== undefined) return underlying;
    if (config.grpcClientFactory !== undefined) {
      underlying = config.grpcClientFactory(config.baseUrl);
    } else {
      // 動的 import で grpc-web を読み込み（未インストールなら明示エラー）
      const mod = await loadGrpcWeb();
      underlying = new mod.GrpcWebClientBase();
    }
    return underlying;
  };

  // unary 呼び出しを Promise として返す実装
  async function unary<Req, Res>(
    desc: GrpcMethodDescriptor<Req, Res>,
    req: Req,
    opts: { metadata?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<Res> {
    // 相関 ID を 1 件生成
    const requestId = generateRequestId();
    // URL を組み立て（baseUrl + /package.Service/Method）
    // service / method は encodeURIComponent でサニタイズ（agent レビュー指摘）
    const baseRoot = config.baseUrl.endsWith("/")
      ? config.baseUrl.slice(0, -1)
      : config.baseUrl;
    const url = `${baseRoot}/${encodeURIComponent(desc.service)}/${encodeURIComponent(desc.method)}`;
    // metadata を組み立て（auth ヘッダ → user metadata → X-Request-Id の順）
    let metadata: Record<string, string> = { ...(opts.metadata ?? {}) };
    if (config.auth !== undefined) {
      const authHeaders = await config.auth.getAuthHeaders();
      metadata = { ...metadata, ...authHeaders };
    }
    metadata[REQUEST_ID_HEADER] = requestId;

    // ログにリクエスト開始を記録
    logger.debug("grpc.request", {
      requestId,
      service: desc.service,
      method: desc.method,
    });

    // 試行 1 回ごとのタイムアウト（opts 優先、無ければ config）
    const perAttemptMs = opts.timeoutMs ?? config.timeoutMs;
    try {
      // withRetry で複数試行を制御（gRPC では perAttempt のみ採用、total は持たない）
      const result = await withRetry(retryPolicy, opts.signal, async (attempt) => {
        // 1 試行を perAttempt タイムアウトで包む
        return await withTimeout(perAttemptMs, opts.signal, async (signal) => {
          // 試行ログ（attempt は 0 オリジン）
          logger.debug("grpc.attempt", { requestId, attempt });
          // underlying クライアントを解決（初回のみ dynamic import / factory 実行）
          const client = await resolveUnderlying();
          // 実 RPC 呼び出し
          return await invokeUnary(
            client,
            url,
            req,
            metadata,
            desc,
            signal,
            requestId,
          );
        });
      });
      // 成功ログ
      logger.info("grpc.response", {
        requestId,
        service: desc.service,
        method: desc.method,
      });
      return result;
    } catch (raw) {
      // エラーを HttpError に正規化（gRPC 由来は既に HttpError なので素通し）
      // normalizeError は HttpRequest を要求するので簡易的に組み立て
      const err = normalizeError(raw, {
        url,
        method: "POST",
        headers: metadata,
        requestId,
      });
      // 失敗ログ
      logger.error("grpc.error", {
        requestId,
        code: err.code,
        message: err.message,
      });
      throw err;
    }
  }

  return { unary };
}
