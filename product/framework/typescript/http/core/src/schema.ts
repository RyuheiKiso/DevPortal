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
