// zod を取り込み（schema 検証ライブラリ）
import { z } from "zod";
// 値配列と公開型を取り込み（schema の単一情報源としても再利用）
import { appErrorKindValues, appErrorSeverityValues, type AppErrorInput } from "./types.js";

// AppErrorKind の z.enum 表現（types の配列を再利用して同期）
// zod 側が mutable tuple を要求するため readonly tuple を一度コピーして渡す
export const appErrorKindSchema = z.enum([...appErrorKindValues] as [(typeof appErrorKindValues)[number], ...(typeof appErrorKindValues)[number][]]);

// AppErrorSeverity の z.enum 表現
export const appErrorSeveritySchema = z.enum([...appErrorSeverityValues] as [(typeof appErrorSeverityValues)[number], ...(typeof appErrorSeverityValues)[number][]]);

// 1 件の検証エラー要素 schema
export const validationIssueSchema = z.object({
  // フィールドパス（string か number の配列）
  path: z.array(z.union([z.string(), z.number()])).optional(),
  // エラーコード
  code: z.string().optional(),
  // ユーザー向けメッセージ
  message: z.string(),
});

// 付随コンテキスト schema
export const errorContextSchema = z.object({
  // 業務操作名
  operation: z.string().optional(),
  // 発生コンポーネント名
  component: z.string().optional(),
  // リクエスト追跡 ID
  requestId: z.string().optional(),
  // 分散トレース ID
  traceId: z.string().optional(),
  // タグ群
  tags: z.array(z.string()).optional(),
  // 追加メタデータ
  metadata: z.record(z.unknown()).optional(),
});

// AppErrorInput 全体の schema
export const appErrorInputSchema: z.ZodType<AppErrorInput> = z.object({
  // エラー分類（必須）
  kind: appErrorKindSchema,
  // 内部メッセージ
  message: z.string().optional(),
  // ユーザー向けメッセージ
  userMessage: z.string().optional(),
  // 詳細コード
  code: z.string().optional(),
  // HTTP ステータスコード（整数）
  status: z.number().int().optional(),
  // リクエスト追跡 ID
  requestId: z.string().optional(),
  // 分散トレース ID
  traceId: z.string().optional(),
  // 詳細情報（任意の値）
  details: z.unknown().optional(),
  // 原因例外（任意の値）
  cause: z.unknown().optional(),
  // 再試行可否
  retryable: z.boolean().optional(),
  // 通報対象か
  reportable: z.boolean().optional(),
  // 重要度
  severity: appErrorSeveritySchema.optional(),
  // 検証エラー内訳
  validationIssues: z.array(validationIssueSchema).optional(),
  // 付随コンテキスト
  context: errorContextSchema.optional(),
});

// throw 版の検証（パース失敗時は ZodError を投げる）
export function validateAppErrorInput(input: unknown): AppErrorInput {
  return appErrorInputSchema.parse(input);
}

// safeParse 版の検証結果（成功時 data、失敗時 error を返す discriminated union）
export type SafeAppErrorInputResult =
  // パース成功（型安全な AppErrorInput が取り出せる）
  | { success: true; data: AppErrorInput }
  // パース失敗（zod の ZodError を保持）
  | { success: false; error: z.ZodError };

// throw しない検証（呼び出し側で結果を分岐させたい場合に使う）
export function safeValidateAppErrorInput(input: unknown): SafeAppErrorInputResult {
  // zod の safeParse をそのまま委譲
  const result = appErrorInputSchema.safeParse(input);
  // discriminated union として返却
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
