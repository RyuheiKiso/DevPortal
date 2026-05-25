// vitest の宣言系 API を取り込み
import { describe, expect, it } from "vitest";
// テスト対象の関数とガードを取り込み
import {
  createMigrationError,
  createNotAvailableError,
  createQuotaError,
  isMigrationError,
  isQuotaError,
  isQuotaExceededLike,
  isStorageNotAvailableError,
  toAppErrorShape,
} from "./errors.js";

// createQuotaError のテストブロック
describe("createQuotaError", () => {
  // 既定値で組み立てるケース
  it("uses defaults when only required fields are missing", () => {
    // 全パラメータ省略で呼ぶ
    const err = createQuotaError({});
    // 識別名は固定値
    expect(err.name).toBe("StorageQuotaError");
    // kind/code はそれぞれ固定値
    expect(err.kind).toBe("quota");
    expect(err.code).toBe("STORAGE_QUOTA");
    // メッセージは既定文言
    expect(err.message).toBe("Storage quota exceeded");
    // key/cause は undefined
    expect(err.key).toBeUndefined();
    expect(err.cause).toBeUndefined();
    // retryable は false 固定
    expect(err.retryable).toBe(false);
  });
  // 任意フィールドを全部指定するケース
  it("preserves provided message, key and cause", () => {
    // 原因例外を用意
    const cause = new Error("disk full");
    // 全フィールド指定で組み立て
    const err = createQuotaError({ message: "no space", key: "user.draft", cause });
    // メッセージが指定通り
    expect(err.message).toBe("no space");
    // key が指定通り
    expect(err.key).toBe("user.draft");
    // cause が同一参照
    expect(err.cause).toBe(cause);
  });
});

// createNotAvailableError のテストブロック
describe("createNotAvailableError", () => {
  // 既定値で組み立てるケース
  it("uses defaults when no message is provided", () => {
    // 引数なしで組み立て
    const err = createNotAvailableError({});
    // 識別名は固定値
    expect(err.name).toBe("StorageNotAvailableError");
    // kind / code は固定値
    expect(err.kind).toBe("not_available");
    expect(err.code).toBe("STORAGE_NOT_AVAILABLE");
    // メッセージは既定文言
    expect(err.message).toBe("Storage backend is not available");
    // retryable は false
    expect(err.retryable).toBe(false);
  });
  // フィールド指定のケース
  it("preserves provided message, key, and cause", () => {
    // 原因例外
    const cause = { reason: "private mode" };
    // 全フィールド指定
    const err = createNotAvailableError({ message: "disabled", key: "session.x", cause });
    // それぞれ転記されている
    expect(err.message).toBe("disabled");
    expect(err.key).toBe("session.x");
    expect(err.cause).toBe(cause);
  });
});

// createMigrationError のテストブロック
describe("createMigrationError", () => {
  // 既定値で組み立てるケース
  it("uses defaults and leaves version fields undefined", () => {
    // 引数なしで組み立て
    const err = createMigrationError({});
    // 識別名 / kind / code は固定値
    expect(err.name).toBe("StorageMigrationError");
    expect(err.kind).toBe("migration");
    expect(err.code).toBe("STORAGE_MIGRATION");
    // メッセージは既定
    expect(err.message).toBe("Storage migration failed");
    // バージョン情報は未指定
    expect(err.fromVersion).toBeUndefined();
    expect(err.toVersion).toBeUndefined();
  });
  // フィールド指定のケース
  it("captures from / to versions and key", () => {
    // 全フィールド指定で組み立て
    const err = createMigrationError({
      fromVersion: 2,
      toVersion: 3,
      key: "user.preferences",
      message: "migrate failed",
      cause: new Error("invalid shape"),
    });
    // バージョン情報が転記されている
    expect(err.fromVersion).toBe(2);
    expect(err.toVersion).toBe(3);
    // key が転記されている
    expect(err.key).toBe("user.preferences");
    // メッセージが指定通り
    expect(err.message).toBe("migrate failed");
    // cause が Error
    expect(err.cause).toBeInstanceOf(Error);
  });
});

// isQuotaError のテストブロック
describe("isQuotaError", () => {
  // 非オブジェクトは false
  it("returns false for non-objects", () => {
    // 数値・文字列・null・undefined を順に確認
    expect(isQuotaError(123)).toBe(false);
    expect(isQuotaError("error")).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });
  // 名前不一致は false
  it("returns false for objects without matching name", () => {
    // 他のエラー形を渡す
    expect(isQuotaError({ name: "SomethingElse" })).toBe(false);
  });
  // 名前一致は true
  it("returns true for created QuotaError", () => {
    // ファクトリで生成したものは判定が true
    expect(isQuotaError(createQuotaError({}))).toBe(true);
  });
});

// isStorageNotAvailableError のテストブロック
describe("isStorageNotAvailableError", () => {
  // 非オブジェクトは false
  it("returns false for non-objects", () => {
    // null / 数値などは false
    expect(isStorageNotAvailableError(null)).toBe(false);
    expect(isStorageNotAvailableError(42)).toBe(false);
  });
  // 名前不一致は false
  it("returns false for objects without matching name", () => {
    // 別のエラー形
    expect(isStorageNotAvailableError({ name: "Other" })).toBe(false);
  });
  // 名前一致は true
  it("returns true for created NotAvailableError", () => {
    // ファクトリ生成物は true
    expect(isStorageNotAvailableError(createNotAvailableError({}))).toBe(true);
  });
});

// isMigrationError のテストブロック
describe("isMigrationError", () => {
  // 非オブジェクトは false
  it("returns false for non-objects", () => {
    // null / 文字列などは false
    expect(isMigrationError(null)).toBe(false);
    expect(isMigrationError("StorageMigrationError")).toBe(false);
  });
  // 名前不一致は false
  it("returns false for objects without matching name", () => {
    // 別のエラー形
    expect(isMigrationError({ name: "Migration" })).toBe(false);
  });
  // 名前一致は true
  it("returns true for created MigrationError", () => {
    // ファクトリ生成物は true
    expect(isMigrationError(createMigrationError({}))).toBe(true);
  });
});

// isQuotaExceededLike のテストブロック
describe("isQuotaExceededLike", () => {
  // 非オブジェクト
  it("returns false for non-objects", () => {
    // 各種スカラー値で false
    expect(isQuotaExceededLike(null)).toBe(false);
    expect(isQuotaExceededLike(123)).toBe(false);
    expect(isQuotaExceededLike("Quota")).toBe(false);
  });
  // 名前一致 (Chrome 系)
  it("recognizes QuotaExceededError name", () => {
    // 標準名で判定 true
    expect(isQuotaExceededLike({ name: "QuotaExceededError" })).toBe(true);
  });
  // 名前一致 (Firefox 古い表記)
  it("recognizes NS_ERROR_DOM_QUOTA_REACHED name", () => {
    // Firefox 表記で true
    expect(isQuotaExceededLike({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(true);
  });
  // code 22
  it("recognizes code 22", () => {
    // Chrome 系 DOMException コード
    expect(isQuotaExceededLike({ code: 22 })).toBe(true);
  });
  // code 1014
  it("recognizes code 1014", () => {
    // Firefox の DOMException コード
    expect(isQuotaExceededLike({ code: 1014 })).toBe(true);
  });
  // どれにも一致しない
  it("returns false when name and code do not match", () => {
    // 別の DOMException 風形
    expect(isQuotaExceededLike({ name: "TypeError", code: 0 })).toBe(false);
  });
});

// toAppErrorShape のテストブロック
describe("toAppErrorShape", () => {
  // 各フィールドの転記を確認
  it("maps storage error to AppError-compatible shape", () => {
    // 入力エラーを生成
    const err = createQuotaError({ key: "k", message: "no room", cause: new Error("c") });
    // 変換結果
    const shape = toAppErrorShape(err);
    // AppError 互換の固定値群
    expect(shape.name).toBe("AppError");
    expect(shape.kind).toBe("system");
    // 詳細コードは元の code が転記される
    expect(shape.code).toBe("STORAGE_QUOTA");
    // メッセージは元の message が転記される
    expect(shape.message).toBe("no room");
    // retryable は元の false が転記される
    expect(shape.retryable).toBe(false);
    // cause は Error
    expect(shape.cause).toBeInstanceOf(Error);
  });
});
