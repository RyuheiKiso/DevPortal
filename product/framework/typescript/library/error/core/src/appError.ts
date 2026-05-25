// 公開型を取り込み
import type { AppError, AppErrorInput } from "./types.js";
// kind 由来の既定値ヘルパを取り込み
import { defaultReportable, defaultRetryable, defaultSeverity, defaultUserMessage } from "./message.js";

// AppErrorInput から AppError を生成する（不足項目は kind 由来の既定値で補完）
export function createAppError(input: AppErrorInput): AppError {
  // userMessage は明示指定が無ければ kind 既定文言を採用
  const userMessage = input.userMessage ?? defaultUserMessage(input.kind);
  return {
    // name は AppError 固定（type guard で利用）
    name: "AppError",
    // 入力 kind をそのまま採用
    kind: input.kind,
    // 内部メッセージは明示指定 → userMessage の順で採用
    message: input.message ?? userMessage,
    // 確定済みの userMessage を採用
    userMessage,
    // 任意フィールドはそのまま透過
    code: input.code,
    status: input.status,
    requestId: input.requestId,
    traceId: input.traceId,
    details: input.details,
    cause: input.cause,
    // retryable は明示指定 → kind+status 既定の順で決定
    retryable: input.retryable ?? defaultRetryable(input.kind, input.status),
    // reportable は明示指定 → kind 既定の順で決定
    reportable: input.reportable ?? defaultReportable(input.kind),
    // severity は明示指定 → kind 既定の順で決定
    severity: input.severity ?? defaultSeverity(input.kind),
    // 検証エラー内訳・コンテキストはそのまま透過
    validationIssues: input.validationIssues,
    context: input.context,
  };
}
