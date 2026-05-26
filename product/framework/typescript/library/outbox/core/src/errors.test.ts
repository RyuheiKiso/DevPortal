// vitest API を取り込み
import { describe, it, expect } from "vitest";
// 対象モジュール
import {
  isOutboxError,
  normalizeError,
  OutboxError,
  toEntryError,
} from "./errors.js";

// OutboxError コンストラクタの動作を検証
describe("OutboxError", () => {
  // 必須プロパティが渡されたときの動作
  it("sets fields from init and defaults retryable=true", () => {
    // 最小構成で生成
    const err = new OutboxError({ code: "OUTBOX_NOT_FOUND", message: "not found" });
    // name / code / message を確認
    expect(err.name).toBe("OutboxError");
    expect(err.code).toBe("OUTBOX_NOT_FOUND");
    expect(err.message).toBe("not found");
    // retryable のデフォルトは true
    expect(err.retryable).toBe(true);
    // 任意フィールドは undefined
    expect(err.entryId).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });

  // すべてのフィールドを設定したとき
  it("preserves explicit retryable / entryId / cause", () => {
    // すべて指定
    const cause = new Error("inner");
    const err = new OutboxError({
      code: "OUTBOX_PUBLISH_FAILED",
      message: "boom",
      retryable: false,
      entryId: "e-1",
      cause,
    });
    // 値が反映される
    expect(err.retryable).toBe(false);
    expect(err.entryId).toBe("e-1");
    expect(err.cause).toBe(cause);
  });

  // ES2022 標準の Error.prototype.cause に紐づく
  it("propagates cause to Error.prototype.cause (ES2022 standard)", () => {
    // 原因例外
    const cause = new Error("inner");
    const err = new OutboxError({ code: "OUTBOX_PUBLISH_FAILED", message: "outer", cause });
    // Error 標準の cause として読み出せる
    expect((err as Error & { cause?: unknown }).cause).toBe(cause);
  });

  // cause 未指定なら Error.cause も未設定
  it("does not set Error.cause when none provided", () => {
    // cause 未指定
    const err = new OutboxError({ code: "OUTBOX_NOT_FOUND", message: "x" });
    // Error.cause は undefined
    expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});

// isOutboxError 型ガードを検証
describe("isOutboxError", () => {
  // OutboxError のインスタンスを true 判定
  it("returns true for an OutboxError instance", () => {
    // 適当なエラーを作る
    const err = new OutboxError({ code: "OUTBOX_DISPOSED", message: "x" });
    // ガード判定
    expect(isOutboxError(err)).toBe(true);
  });

  // 通常の Error は false 判定
  it("returns false for a generic Error", () => {
    // 通常 Error は対象外
    expect(isOutboxError(new Error("x"))).toBe(false);
  });

  // 非 Error 値は false 判定
  it("returns false for non-Error values", () => {
    // 文字列やオブジェクトを与えても false
    expect(isOutboxError("OutboxError")).toBe(false);
    expect(isOutboxError({ name: "OutboxError", code: "OUTBOX_NOT_FOUND" })).toBe(false);
    expect(isOutboxError(undefined)).toBe(false);
  });

  // name は一致するが code がないオブジェクトは false
  it("returns false for Error with name=OutboxError but no code", () => {
    // 単なる Error の name を書き換えただけ
    const err = new Error("oops");
    err.name = "OutboxError";
    // code が無いので false
    expect(isOutboxError(err)).toBe(false);
  });
});

// normalizeError を検証
describe("normalizeError", () => {
  // Error はそのまま返す
  it("returns the same Error instance", () => {
    // インスタンスを生成
    const e = new Error("orig");
    // 参照同一性を確認
    expect(normalizeError(e)).toBe(e);
  });

  // 文字列は Error 化される
  it("wraps a string into an Error with that message", () => {
    // 文字列を渡す
    const e = normalizeError("oops");
    // Error 化されメッセージが一致
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("oops");
  });

  // オブジェクトは JSON 化されてメッセージとなる
  it("JSON-stringifies non-Error objects into the message", () => {
    // オブジェクトを渡す
    const e = normalizeError({ a: 1 });
    // メッセージは JSON
    expect(e.message).toBe('{"a":1}');
  });

  // 循環参照などで JSON 化が失敗するケース
  it("falls back to 'unknown error' when JSON.stringify throws", () => {
    // 循環参照を作る
    const a: Record<string, unknown> = {};
    a.self = a;
    // JSON.stringify が throw する
    const e = normalizeError(a);
    // フォールバックメッセージ
    expect(e.message).toBe("unknown error");
  });
});

// toEntryError を検証
describe("toEntryError", () => {
  // OutboxError は code が記録される
  it("includes code for OutboxError", () => {
    // 適当な OutboxError
    const err = new OutboxError({ code: "OUTBOX_PUBLISH_FAILED", message: "x" });
    // 変換
    const result = toEntryError(err, 1000);
    // 期待値
    expect(result).toEqual({ message: "x", code: "OUTBOX_PUBLISH_FAILED", at: 1000 });
  });

  // 通常 Error は code 省略
  it("omits code for plain Error", () => {
    // 通常エラー
    const err = new Error("oops");
    // 変換
    const result = toEntryError(err, 2000);
    // code は無し
    expect(result).toEqual({ message: "oops", at: 2000 });
  });

  // 非 Error も normalizeError 経由で扱える
  it("handles non-Error values via normalizeError", () => {
    // 文字列を渡す
    const result = toEntryError("oops", 3000);
    // メッセージのみ
    expect(result).toEqual({ message: "oops", at: 3000 });
  });
});
