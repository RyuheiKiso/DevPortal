// 公開型を取り込み
import type { AppError, LogRecord, NotificationInput, NotificationLevel } from "./types.js";

// AppError.severity を通知レベルに圧縮する
// critical / error はまとめて "error" 表示、warning / info はそのまま採用
function notificationLevel(error: AppError): NotificationLevel {
  // info はそのまま
  if (error.severity === "info") {
    return "info";
  }
  // warning はそのまま
  if (error.severity === "warning") {
    return "warning";
  }
  // critical / error はまとめて error 表示
  return "error";
}

// AppError を構造化ログ用 record に変換する（cause は意図的に含めない）
export function toLogRecord(error: AppError): LogRecord {
  return {
    // ログ検索キーとして固定値を入れる
    errorName: "AppError",
    // フィールドを逐次コピー
    kind: error.kind,
    severity: error.severity,
    message: error.message,
    userMessage: error.userMessage,
    code: error.code,
    status: error.status,
    requestId: error.requestId,
    traceId: error.traceId,
    retryable: error.retryable,
    reportable: error.reportable,
    details: error.details,
    validationIssues: error.validationIssues,
    context: error.context,
  };
}

// AppError を通知アダプタ向けの toast 入力に変換する
export function toNotification(error: AppError): NotificationInput {
  return {
    // toast 固定（将来 dialog 等を追加する場合はここで分岐）
    kind: "toast",
    // severity を通知レベルへ圧縮
    level: notificationLevel(error),
    // validation 系はタイトルを切り替えてフォーム文脈であることを示す
    title: error.kind === "validation" ? "Input error" : "Error",
    // 本文は必ずユーザー向け文言を採用
    message: error.userMessage,
    // dedupe キーは code 優先、無ければ kind を使う
    dedupeKey: error.code ?? error.kind,
  };
}
