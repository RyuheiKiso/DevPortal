// zod を取り込み（dependencies に固定）
import { z } from "zod";

// RetryPolicy の値部分（関数フィールドは検証対象外）
export const retryPolicySchema = z.object({
  // 0 以上の整数
  maxRetries: z.number().int().min(0),
  // 0 以上の整数（ms）
  backoffBaseMs: z.number().int().min(0),
  // 0 以上の整数（ms、任意）
  backoffMaxMs: z.number().int().min(0).optional(),
  // ジッタ戦略の限定値
  jitter: z.enum(["full", "none"]).optional(),
  // status コード配列（任意）
  retryableStatuses: z.array(z.number().int()).optional(),
  // 非冪等メソッドでも retry を許可する明示オプトイン（C-A2、任意）
  // 型としては RetryPolicy.allowNonIdempotent (types.ts) と対応する
  allowNonIdempotent: z.boolean().optional(),
});

// TimeoutPolicy のスキーマ
export const timeoutPolicySchema = z.object({
  // リクエスト全体タイムアウト（任意）
  totalMs: z.number().int().min(0).optional(),
  // 1 試行ごとタイムアウト（任意）
  perAttemptMs: z.number().int().min(0).optional(),
});

// HttpClientConfig の検証可能サブセット（関数フィールドは除外）
export const httpClientConfigSchema = z.object({
  // 有効な URL（任意）
  baseUrl: z.string().url().optional(),
  // 既定ヘッダ（任意）
  defaultHeaders: z.record(z.string()).optional(),
  // 相関 ID ヘッダ名（任意、空文字不可、C-A7）
  requestIdHeader: z.string().min(1).optional(),
  // retry の部分指定（任意）
  retry: retryPolicySchema.partial().optional(),
  // timeout（任意）
  timeout: timeoutPolicySchema.optional(),
});

// 検証ヘルパ：失敗時は ZodError を throw する
export function validateHttpClientConfig(
  input: unknown,
): z.infer<typeof httpClientConfigSchema> {
  return httpClientConfigSchema.parse(input);
}

// gRPC では HTTP status は使われないため `retryableStatuses` を除外したサブセットを使う (M2)
// (型レベルでも GrpcRetryPolicy = Omit<Partial<RetryPolicy>, "retryableStatuses"> で表現済み)
// strict() を付けることで利用者が誤って `retryableStatuses` を渡した場合に ZodError を出す
// (silent no-op を防いで設定ミスを early に検知させる)
const grpcRetryPolicySchema = retryPolicySchema
  .partial()
  .omit({ retryableStatuses: true })
  .strict();

// GrpcClientConfig 検証用スキーマ（関数フィールドは対象外）
// agent レビュー指摘により追加: createGrpcClient 冒頭で baseUrl を検証して空文字を弾く
// strict() で未知のキー (例: retryableStatuses を retry 直下ではなく config 直下に置くようなミス) を弾く
export const grpcClientConfigSchema = z.object({
  baseUrl: z.string().url(),
  timeoutMs: z.number().int().min(0).optional(),
  retry: grpcRetryPolicySchema.optional(),
});

// 検証ヘルパ
export function validateGrpcClientConfig(
  input: unknown,
): z.infer<typeof grpcClientConfigSchema> {
  return grpcClientConfigSchema.parse(input);
}
