// gRPC エラー正規化のためのユーティリティ
import { HttpError } from "../errors.js";

// gRPC 標準 status code → 名前のマッピング（grpc-status-codes 準拠）
export const GRPC_STATUS_NAMES: Readonly<Record<number, string>> = Object.freeze({
  // 0=OK は本マッピングに含めない（成功は throw しない）
  1: "CANCELLED",
  2: "UNKNOWN",
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND",
  6: "ALREADY_EXISTS",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  9: "FAILED_PRECONDITION",
  10: "ABORTED",
  11: "OUT_OF_RANGE",
  12: "UNIMPLEMENTED",
  13: "INTERNAL",
  14: "UNAVAILABLE",
  15: "DATA_LOSS",
  16: "UNAUTHENTICATED",
});

// リトライ対象とみなす gRPC status code
// UNAVAILABLE / DEADLINE_EXCEEDED / RESOURCE_EXHAUSTED を既定で対象に含める
export const RETRYABLE_GRPC_CODES: readonly number[] = [4, 8, 14];

// grpc-web 由来のエラーを HttpError に正規化する
export function grpcStatusToHttpError(
  status: { code: number; message: string },
  requestId: string,
): HttpError {
  // 既知の code 名を取り出す（未知なら "GRPC_<code>"）
  const codeName = GRPC_STATUS_NAMES[status.code] ?? `GRPC_${status.code}`;
  // リトライ可否は事前定義リストで判定
  const retryable = RETRYABLE_GRPC_CODES.includes(status.code);
  // HttpError として throw 用に組み立て（status は HTTP ではないので未設定）
  return new HttpError({
    message: status.message,
    code: codeName,
    retryable,
    requestId,
  });
}
