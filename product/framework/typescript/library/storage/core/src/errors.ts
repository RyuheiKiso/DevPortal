// 公開型を取り込み
import type {
  MigrationError,
  QuotaError,
  StorageErrorLike,
  StorageNotAvailableError,
} from "./types.js";

// QuotaError を組み立てる
export function createQuotaError(input: {
  // 影響を受けたキー (任意)
  key?: string;
  // 人間向けメッセージ (省略時は既定文言)
  message?: string;
  // 原因例外 (任意)
  cause?: unknown;
}): QuotaError {
  // 完成した QuotaError を返す (全フィールドを揃える)
  return {
    // 識別名 (固定値)
    name: "StorageQuotaError",
    // 区分 (固定値)
    kind: "quota",
    // コード (固定値)
    code: "STORAGE_QUOTA",
    // メッセージ (未指定時は既定文言)
    message: input.message ?? "Storage quota exceeded",
    // 影響キー (指定時のみ)
    key: input.key,
    // 原因 (指定時のみ)
    cause: input.cause,
    // クォータ枯渇は自動再試行余地なし (アプリ側で掃除戦略を決定)
    retryable: false,
  };
}

// StorageNotAvailableError を組み立てる
export function createNotAvailableError(input: {
  // 影響を受けたキー (任意)
  key?: string;
  // 人間向けメッセージ (省略時は既定文言)
  message?: string;
  // 原因例外 (任意)
  cause?: unknown;
}): StorageNotAvailableError {
  // 完成した StorageNotAvailableError を返す
  return {
    // 識別名 (固定値)
    name: "StorageNotAvailableError",
    // 区分 (固定値)
    kind: "not_available",
    // コード (固定値)
    code: "STORAGE_NOT_AVAILABLE",
    // メッセージ (未指定時は既定文言)
    message: input.message ?? "Storage backend is not available",
    // 影響キー (指定時のみ)
    key: input.key,
    // 原因 (指定時のみ)
    cause: input.cause,
    // 利用不可 (環境制約) は自動再試行で解消しないため false
    retryable: false,
  };
}

// MigrationError を組み立てる
export function createMigrationError(input: {
  // 失敗したステップの from バージョン (任意)
  fromVersion?: number;
  // 失敗したステップの to バージョン (任意)
  toVersion?: number;
  // 影響を受けたキー (任意)
  key?: string;
  // 人間向けメッセージ (省略時は既定文言)
  message?: string;
  // 原因例外 (任意)
  cause?: unknown;
}): MigrationError {
  // 完成した MigrationError を返す
  return {
    // 識別名 (固定値)
    name: "StorageMigrationError",
    // 区分 (固定値)
    kind: "migration",
    // コード (固定値)
    code: "STORAGE_MIGRATION",
    // メッセージ (未指定時は既定文言)
    message: input.message ?? "Storage migration failed",
    // 影響キー (指定時のみ)
    key: input.key,
    // 原因 (指定時のみ)
    cause: input.cause,
    // 失敗バージョン情報 (指定時のみ)
    fromVersion: input.fromVersion,
    // 失敗バージョン情報 (指定時のみ)
    toVersion: input.toVersion,
    // マイグレーション失敗はコード修正が必要 (自動再試行不可)
    retryable: false,
  };
}

// 任意の値が QuotaError 形であるかを判定する
export function isQuotaError(value: unknown): value is QuotaError {
  // オブジェクトでない場合は不一致
  if (typeof value !== "object" || value === null) return false;
  // name フィールドの値を取得 (any キャストせず record として扱う)
  const record = value as Record<string, unknown>;
  // 名前が一致するかどうかで判定する
  return record["name"] === "StorageQuotaError";
}

// 任意の値が StorageNotAvailableError 形であるかを判定する
export function isStorageNotAvailableError(value: unknown): value is StorageNotAvailableError {
  // オブジェクトでない場合は不一致
  if (typeof value !== "object" || value === null) return false;
  // record として扱う
  const record = value as Record<string, unknown>;
  // 名前が一致するかどうかで判定する
  return record["name"] === "StorageNotAvailableError";
}

// 任意の値が MigrationError 形であるかを判定する
export function isMigrationError(value: unknown): value is MigrationError {
  // オブジェクトでない場合は不一致
  if (typeof value !== "object" || value === null) return false;
  // record として扱う
  const record = value as Record<string, unknown>;
  // 名前が一致するかどうかで判定する
  return record["name"] === "StorageMigrationError";
}

// DOMException ベースの QuotaExceededError かを判定する
// localStorage の容量超過時に投げられる例外は DOMException(code=22, name="QuotaExceededError")
// Firefox 互換の code=1014 / "NS_ERROR_DOM_QUOTA_REACHED" にも対応
export function isQuotaExceededLike(value: unknown): boolean {
  // オブジェクトでない場合は false
  if (typeof value !== "object" || value === null) return false;
  // record として扱う
  const record = value as Record<string, unknown>;
  // name フィールドを取得
  const name = record["name"];
  // code フィールドを取得
  const code = record["code"];
  // QuotaExceededError の名前一致 (Chrome/Safari/Edge)
  if (name === "QuotaExceededError") return true;
  // Firefox 古い表記の名前一致
  if (name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  // DOMException code 22 一致 (Chrome/Safari/Edge)
  if (code === 22) return true;
  // DOMException code 1014 一致 (Firefox)
  if (code === 1014) return true;
  // いずれにも一致しない
  return false;
}

// StorageErrorLike を AppError 形 (簡易) に変換する
// @k1s0-ts-error/core への直接依存は避け、互換シリアライザのみ提供する
export function toAppErrorShape(error: StorageErrorLike): {
  name: string;
  kind: "system";
  code: string;
  message: string;
  retryable: boolean;
  cause?: unknown;
} {
  // AppError 互換の最小形を返す (kind は AppError の "system" に固定マッピング)
  return {
    // AppError は name フィールドが識別子
    name: "AppError",
    // すべてのストレージ系エラーは AppError 上 "system" 扱い
    kind: "system",
    // 詳細コードは StorageError の code をそのまま使う
    code: error.code,
    // メッセージはそのまま転記
    message: error.message,
    // リトライ可否もそのまま転記
    retryable: error.retryable,
    // 原因例外 (存在時のみ)
    cause: error.cause,
  };
}
