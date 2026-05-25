// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// 内部 helper を直接テストするためファイル単位で import（index には公開していない readString/readNumber も覆う）
import { isRecord, readNumber, readString } from "./guards.js";
// AppError 判定・SerializedAppError 判定・シリアライザは公開 API 経由でテスト
import { createAppError, isAppError, isSerializedAppError, serializeError } from "./index.js";

// isRecord は object と非 object を厳密に区別する
describe("isRecord", () => {
  // plain object は true
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ foo: 1 })).toBe(true);
  });

  // null や primitive は false
  it("returns false for null and primitives", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(0)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(true)).toBe(false);
  });

  // 配列も object なので true（呼び出し側で必要なら追加チェック）
  it("returns true for arrays (use Array.isArray for stricter check)", () => {
    expect(isRecord([])).toBe(true);
  });
});

// readString は非空文字列だけを採用する
describe("readString", () => {
  // 通常の非空文字列を採用
  it("returns the string when non-empty", () => {
    expect(readString({ a: "hello" }, "a")).toBe("hello");
  });

  // 空文字列は意味のない値として undefined
  it("returns undefined for empty strings", () => {
    expect(readString({ a: "" }, "a")).toBeUndefined();
  });

  // 非文字列は undefined
  it("returns undefined for non-string values", () => {
    expect(readString({ a: 1 }, "a")).toBeUndefined();
    expect(readString({ a: null }, "a")).toBeUndefined();
    expect(readString({ a: undefined }, "a")).toBeUndefined();
  });
});

// readNumber は有限数だけを採用する
describe("readNumber", () => {
  // 通常の有限数を採用
  it("returns the number when finite", () => {
    expect(readNumber({ a: 42 }, "a")).toBe(42);
    expect(readNumber({ a: 0 }, "a")).toBe(0);
    expect(readNumber({ a: -1.5 }, "a")).toBe(-1.5);
  });

  // NaN / Infinity は弾く
  it("returns undefined for NaN / Infinity", () => {
    expect(readNumber({ a: NaN }, "a")).toBeUndefined();
    expect(readNumber({ a: Infinity }, "a")).toBeUndefined();
    expect(readNumber({ a: -Infinity }, "a")).toBeUndefined();
  });

  // 非数値は undefined
  it("returns undefined for non-number values", () => {
    expect(readNumber({ a: "1" }, "a")).toBeUndefined();
    expect(readNumber({ a: null }, "a")).toBeUndefined();
  });
});

// isAppError は AppError 形状を厳密に検証する
describe("isAppError", () => {
  // createAppError の戻り値は必ず true
  it("returns true for values produced by createAppError", () => {
    expect(isAppError(createAppError({ kind: "unknown" }))).toBe(true);
  });

  // object でなければ即 false
  it("returns false for non-objects", () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError("AppError")).toBe(false);
  });

  // name が違えば false
  it("returns false when name does not match", () => {
    expect(
      isAppError({
        name: "Error",
        kind: "unknown",
        message: "x",
        userMessage: "x",
        retryable: false,
        reportable: false,
      }),
    ).toBe(false);
  });

  // kind が未知の文字列なら false（厳密化された分岐）
  it("returns false when kind is not a known AppErrorKind", () => {
    expect(
      isAppError({
        name: "AppError",
        kind: "made-up",
        message: "x",
        userMessage: "x",
        retryable: false,
        reportable: false,
      }),
    ).toBe(false);
  });

  // 必須フィールドが型違反なら false
  it("returns false when required fields have wrong types", () => {
    // message が数値
    expect(
      isAppError({
        name: "AppError",
        kind: "unknown",
        message: 1,
        userMessage: "x",
        retryable: false,
        reportable: false,
      }),
    ).toBe(false);
    // userMessage が欠落
    expect(
      isAppError({
        name: "AppError",
        kind: "unknown",
        message: "x",
        retryable: false,
        reportable: false,
      }),
    ).toBe(false);
    // retryable が真偽値でない
    expect(
      isAppError({
        name: "AppError",
        kind: "unknown",
        message: "x",
        userMessage: "x",
        retryable: "no",
        reportable: false,
      }),
    ).toBe(false);
    // reportable が真偽値でない
    expect(
      isAppError({
        name: "AppError",
        kind: "unknown",
        message: "x",
        userMessage: "x",
        retryable: false,
        reportable: 0,
      }),
    ).toBe(false);
  });

  // kind が数値（非文字列）なら false
  it("returns false when kind is not a string", () => {
    expect(
      isAppError({
        name: "AppError",
        kind: 1,
        message: "x",
        userMessage: "x",
        retryable: false,
        reportable: false,
      }),
    ).toBe(false);
  });

  // SerializedAppError は name が "SerializedAppError" なので isAppError では弾かれる
  it("rejects SerializedAppError shape", () => {
    // AppError を serialize して SerializedAppError 形にする
    const serialized = serializeError(createAppError({ kind: "system", message: "boom" }));
    // isAppError では false（name の literal が異なる）
    expect(isAppError(serialized)).toBe(false);
  });
});

// isSerializedAppError は SerializedAppError 形状を厳密に判定する
describe("isSerializedAppError", () => {
  // serializeError の戻り値は必ず true
  it("returns true for values produced by serializeError", () => {
    // createAppError → serializeError → isSerializedAppError の往復
    const serialized = serializeError(createAppError({ kind: "unknown" }));
    expect(isSerializedAppError(serialized)).toBe(true);
  });

  // 通常の AppError は弾く
  it("returns false for AppError shape", () => {
    expect(isSerializedAppError(createAppError({ kind: "unknown" }))).toBe(false);
  });

  // object でなければ即 false
  it("returns false for non-objects", () => {
    expect(isSerializedAppError(null)).toBe(false);
    expect(isSerializedAppError("SerializedAppError")).toBe(false);
  });

  // name が違えば false
  it("returns false when name does not match", () => {
    expect(
      isSerializedAppError({
        name: "Other",
        kind: "unknown",
        message: "x",
        userMessage: "x",
        retryable: false,
        reportable: false,
      }),
    ).toBe(false);
  });

  // kind が未知の文字列なら false
  it("returns false when kind is not a known AppErrorKind", () => {
    expect(
      isSerializedAppError({
        name: "SerializedAppError",
        kind: "made-up",
        message: "x",
        userMessage: "x",
        retryable: false,
        reportable: false,
      }),
    ).toBe(false);
  });

  // 必須フィールドが型違反なら false
  it("returns false when required fields have wrong types", () => {
    // message 型違反
    expect(
      isSerializedAppError({
        name: "SerializedAppError",
        kind: "unknown",
        message: 1,
        userMessage: "x",
        retryable: false,
        reportable: false,
      }),
    ).toBe(false);
    // userMessage 欠落
    expect(
      isSerializedAppError({
        name: "SerializedAppError",
        kind: "unknown",
        message: "x",
        retryable: false,
        reportable: false,
      }),
    ).toBe(false);
    // retryable 型違反
    expect(
      isSerializedAppError({
        name: "SerializedAppError",
        kind: "unknown",
        message: "x",
        userMessage: "x",
        retryable: "no",
        reportable: false,
      }),
    ).toBe(false);
    // reportable 型違反
    expect(
      isSerializedAppError({
        name: "SerializedAppError",
        kind: "unknown",
        message: "x",
        userMessage: "x",
        retryable: false,
        reportable: 0,
      }),
    ).toBe(false);
  });
});
