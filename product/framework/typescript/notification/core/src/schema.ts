// zod を取り込み
import { z } from "zod";
// 公開型を取り込み（z.ZodType の型整合のため）
import type { NotificationLevel } from "./types.js";

// 通知レベルを表すスキーマ
export const notificationLevelSchema: z.ZodType<NotificationLevel> = z.enum([
  // 順序: info < success < warning < error
  "info",
  "success",
  "warning",
  "error",
]);

// Manager 設定のうち、関数オブジェクト以外の値を検証するスキーマ
// now / idFactory / timer は関数なので zod 対象外（型のみで保証）
export const notificationConfigSchema = z.object({
  // 既定の toast 表示時間（ms）。0 以上の有限数のみ許可
  defaultDuration: z.number().int().nonnegative().optional(),
  // キュー上限（1 以上）
  maxQueueSize: z.number().int().positive().optional(),
});

// 上記スキーマが表現する型（schema.parse の戻り値）
export type NotificationConfigInput = z.infer<typeof notificationConfigSchema>;

// 任意の値を notificationConfigSchema で検証する
// 失敗時は ZodError を投げる
export function validateNotificationConfig(input: unknown): NotificationConfigInput {
  // parse は失敗時に throw、成功時は型確定値を返す
  return notificationConfigSchema.parse(input);
}
