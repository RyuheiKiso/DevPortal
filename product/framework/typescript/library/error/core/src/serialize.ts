// AppError と SerializedAppError の公開型を取り込み
import type { AppError, SerializedAppError } from "./types.js";

// AppError を JSON シリアライズ可能な SerializedAppError に変換する
// - cause は循環参照や非 JSON 化可能な値を含む可能性があるため落とす
// - name は SerializedAppError 用に "SerializedAppError" 固定で出力（isAppError による誤判定を防ぐ）
export function serializeError(error: AppError): SerializedAppError {
  return {
    // 名前は SerializedAppError 固定（AppError との区別キー）
    name: "SerializedAppError",
    // エラー分類はそのまま
    kind: error.kind,
    // 内部メッセージはそのまま
    message: error.message,
    // ユーザー向けメッセージはそのまま
    userMessage: error.userMessage,
    // 詳細コード
    code: error.code,
    // HTTP ステータス
    status: error.status,
    // リクエスト追跡 ID
    requestId: error.requestId,
    // 分散トレース ID
    traceId: error.traceId,
    // 任意の詳細情報
    details: error.details,
    // 再試行可否
    retryable: error.retryable,
    // 監視通報対象か
    reportable: error.reportable,
    // 重要度
    severity: error.severity,
    // 検証エラーの内訳
    validationIssues: error.validationIssues,
    // 付随コンテキスト
    context: error.context,
  };
}

// SerializedAppError を AppError に復元する
// - name を "AppError" に戻し、isAppError で識別できる状態にする
// - cause は serialize 時に落としているため、復元時に明示渡しできる
export function deserializeAppError(serialized: SerializedAppError, options?: { cause?: unknown }): AppError {
  return {
    // name を AppError に戻す
    name: "AppError",
    // 以下は SerializedAppError の値をそのまま採用
    kind: serialized.kind,
    message: serialized.message,
    userMessage: serialized.userMessage,
    code: serialized.code,
    status: serialized.status,
    requestId: serialized.requestId,
    traceId: serialized.traceId,
    details: serialized.details,
    // cause は呼び出し側が明示渡し可能（未指定なら undefined）
    cause: options?.cause,
    retryable: serialized.retryable,
    reportable: serialized.reportable,
    severity: serialized.severity,
    validationIssues: serialized.validationIssues,
    context: serialized.context,
  };
}
