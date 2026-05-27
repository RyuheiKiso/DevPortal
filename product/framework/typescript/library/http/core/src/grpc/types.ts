// gRPC 呼び出しで使う型定義
import type { AuthProvider, Logger, RetryPolicy } from "../types.js";

// gRPC metadata は文字列 KV ペア（gRPC-web Metadata と互換）
export type GrpcMetadata = Record<string, string>;

// 1 回の unary 呼び出しに渡せるオプション
export interface GrpcCallOptions {
  // 任意の追加 metadata（auth metadata とマージ）
  metadata?: GrpcMetadata;
  // 中断用 AbortSignal（ユーザ指定）
  signal?: AbortSignal;
  // 任意の per-call タイムアウト（設定 timeoutMs を一時上書き）
  timeoutMs?: number;
  /**
   * この呼び出しが冪等であることを利用者が明示するフラグ（H2 / v0.2 で追加）
   *
   * gRPC unary は HTTP の POST と同様に副作用を持ちうる。安全側として、未指定 / false の場合は
   * retry を無効化する (charge / transfer 系 RPC が UNAVAILABLE で何度も実行される事故を防ぐ)。
   *
   * 副作用のない RPC (Get・List・Watch 系) や、サーバ側で冪等性が担保された RPC では
   * 利用者が明示的に `idempotent: true` を渡すことで `GrpcClientConfig.retry` を有効化できる。
   *
   * 全 RPC を一括で許可したい場合は `GrpcClientConfig.retry.allowNonIdempotent: true` を使う。
   */
  idempotent?: boolean;
}

// 呼び出し対象メソッドの記述子（gRPC-web の MethodDescriptor 相当）
export interface GrpcMethodDescriptor<Req, Res> {
  // サービス完全名（"package.Service" 形式）
  service: string;
  // メソッド名
  method: string;
  // リクエストを protobuf バイト列にシリアライズする関数
  requestSerialize: (req: Req) => Uint8Array;
  // レスポンスバイト列をデシリアライズする関数
  responseDeserialize: (bytes: Uint8Array) => Res;
}

// 公開する gRPC クライアントインターフェース（現状は unary のみ）
export interface GrpcClient {
  // unary 呼び出し（リクエスト 1 つに対しレスポンス 1 つ）
  unary<Req, Res>(
    desc: GrpcMethodDescriptor<Req, Res>,
    req: Req,
    opts?: GrpcCallOptions,
  ): Promise<Res>;
}

// 内部利用：grpc-web 互換の最小 Client 契約（factory が返すオブジェクト）
// rpcCall は (url, body, metadata, methodDescriptor, callback) シグネチャを想定
export interface GrpcWebLikeClient {
  // unary 呼び出しの実体（gRPC-web の GrpcWebClientBase.rpcCall 相当）
  rpcCall<Req, Res>(
    url: string,
    request: Req,
    metadata: GrpcMetadata,
    methodDescriptor: unknown,
    callback: (err: GrpcCallError | null, response: Res) => void,
  ): unknown;
}

// grpc-web のエラー形（code/message を必ず持つ）
export interface GrpcCallError {
  // gRPC status code（0 = OK、その他は errors.ts のテーブル参照）
  code: number;
  // 人間可読メッセージ
  message: string;
  // 任意の付加 metadata
  metadata?: GrpcMetadata;
}

// gRPC では HTTP status は使われないため `retryableStatuses` は意味を持たない。
// 型レベルで指定不可にして、利用者が誤って渡しても compile-time に気づけるようにする (M2)
export type GrpcRetryPolicy = Omit<Partial<RetryPolicy>, "retryableStatuses">;

// createGrpcClient に渡す設定
export interface GrpcClientConfig {
  // gRPC-web エンドポイント（プロキシ URL のベース）
  baseUrl: string;
  // 認証 metadata 供給（任意）
  auth?: AuthProvider;
  // リトライポリシー（任意、HTTP と同じ RetryPolicy から retryableStatuses を除いたサブセット、M2）
  // gRPC では shouldRetry または HttpError.retryable で判定される
  // 既定では `idempotent` オプトインが必要 (H2)、`allowNonIdempotent: true` で全 RPC 許可
  retry?: GrpcRetryPolicy;
  // 既定の per-call タイムアウト（任意）
  timeoutMs?: number;
  // 構造一致 Logger（任意）
  logger?: Logger;
  // X-Request-Id 生成関数（任意）
  generateRequestId?: () => string;
  // テスト/差替用：grpc-web の代わりに使う Client ファクトリ
  grpcClientFactory?: (baseUrl: string) => GrpcWebLikeClient;
}
