// AppError の公開型と kind/severity の値配列を取り込み
import {
  appErrorKindValues,
  appErrorSeverityValues,
  type AppError,
  type AppErrorKind,
  type AppErrorSeverity,
  type SerializedAppError,
} from "./types.js";

// object 型かつ null でないことを判定（typeof null === "object" の罠を回避）
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// record から非空文字列を取り出すヘルパ（空文字列は undefined と同等扱い）
export function readString(value: Record<string, unknown>, key: string): string | undefined {
  // raw 値を取り出して string 判定
  const raw = value[key];
  // 空文字列は意味のない値として除外
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

// record から有限数を取り出すヘルパ（NaN / Infinity を除外）
export function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  // raw 値を取り出して number 判定
  const raw = value[key];
  // Number.isFinite で NaN / Infinity を弾く
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

// 文字列が AppErrorKind の許容値に含まれるか判定
function isAppErrorKind(value: unknown): value is AppErrorKind {
  // 文字列でなければ即 false
  if (typeof value !== "string") {
    return false;
  }
  // appErrorKindValues は readonly tuple なので一旦 string[] と見なして includes を呼ぶ
  return (appErrorKindValues as readonly string[]).includes(value);
}

// 文字列が AppErrorSeverity の許容値に含まれるか判定
// AppError の severity は createAppError で必ず埋まる必須フィールドなので、
// 型ガードでも値域までチェックして「severity 欠落／不正値が AppError 扱いされる」状態を防ぐ
function isAppErrorSeverity(value: unknown): value is AppErrorSeverity {
  // 文字列でなければ即 false
  if (typeof value !== "string") {
    return false;
  }
  // appErrorSeverityValues は readonly tuple なので string[] と見なして includes を呼ぶ
  return (appErrorSeverityValues as readonly string[]).includes(value);
}

// 任意値が AppError 形状を満たすかを厳密に判定する type guard
// SerializedAppError は name が "SerializedAppError" なのでここでは false となり、誤判定を防ぐ
export function isAppError(value: unknown): value is AppError {
  // object でない値は AppError ではない
  if (!isRecord(value)) {
    return false;
  }
  // name 固定値 + kind/severity の値域チェック + 必須フィールドの型チェック
  return (
    value.name === "AppError" &&
    isAppErrorKind(value.kind) &&
    typeof value.message === "string" &&
    typeof value.userMessage === "string" &&
    typeof value.retryable === "boolean" &&
    typeof value.reportable === "boolean" &&
    isAppErrorSeverity(value.severity)
  );
}

// 任意値が SerializedAppError 形状を満たすかを厳密に判定する type guard
// transport 経由で受け取った JSON を deserializeAppError に渡す前のチェックに利用する
export function isSerializedAppError(value: unknown): value is SerializedAppError {
  // object でない値は SerializedAppError ではない
  if (!isRecord(value)) {
    return false;
  }
  // name 固定値 + kind/severity の値域チェック + 必須フィールドの型チェック
  return (
    value.name === "SerializedAppError" &&
    isAppErrorKind(value.kind) &&
    typeof value.message === "string" &&
    typeof value.userMessage === "string" &&
    typeof value.retryable === "boolean" &&
    typeof value.reportable === "boolean" &&
    isAppErrorSeverity(value.severity)
  );
}
