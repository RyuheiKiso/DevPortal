// zod を取り込み (関数オブジェクト以外の数値・列挙の早期検証に使用)
import { z } from "zod";

// RetryPolicy の検証スキーマ (関数フィールド random / shouldRetry は型のみで保証)
export const retryPolicySchema = z.object({
  // 最大リトライ回数 (0 以上の整数)
  maxRetries: z.number().int().nonnegative().optional(),
  // 指数バックオフ基底 (0 以上の整数 ms)
  backoffBaseMs: z.number().int().nonnegative().optional(),
  // バックオフ上限 (1 以上の整数 ms)
  backoffMaxMs: z.number().int().positive().optional(),
  // ジッタ戦略 ("full" / "none")
  jitter: z.enum(["full", "none"]).optional(),
});

// SchedulerOptions の検証スキーマ
export const schedulerOptionsSchema = z.object({
  // tick 間隔 (1 以上の整数 ms)
  intervalMs: z.number().int().positive().optional(),
  // jitterRatio (0..1)
  jitterRatio: z.number().min(0).max(1).optional(),
  // 1 tick あたりの最大処理件数 (1 以上の整数)
  batchSize: z.number().int().positive().optional(),
  // 自動起動フラグ
  autoStart: z.boolean().optional(),
});

// dlqAutoArchive の検証スキーマ
export const dlqAutoArchiveSchema = z.object({
  // DLQ の最大保持件数 (1 以上の整数)
  maxEntries: z.number().int().positive(),
});

// OutboxManagerConfig のうち、関数オブジェクト以外の値を検証するスキーマ
// storage / publisher / idFactory / now / timer / logger は関数オブジェクトなので zod 対象外
export const outboxManagerConfigSchema = z.object({
  // RetryPolicy の partial
  retry: retryPolicySchema.optional(),
  // SchedulerOptions の partial
  scheduler: schedulerOptionsSchema.optional(),
  // DLQ 自動アーカイブ
  dlqAutoArchive: dlqAutoArchiveSchema.optional(),
  // 1 試行あたりのタイムアウト ms
  perAttemptTimeoutMs: z.number().int().positive().optional(),
});

// 上記スキーマの型 (parse の戻り値)
export type OutboxManagerConfigInput = z.infer<typeof outboxManagerConfigSchema>;

// 任意の値を outboxManagerConfigSchema で検証する
// 失敗時は ZodError を投げる
export function validateOutboxManagerConfig(input: unknown): OutboxManagerConfigInput {
  // parse は失敗時に throw、成功時は型確定値を返す
  return outboxManagerConfigSchema.parse(input);
}
