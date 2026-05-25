// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// 公開 API 経由でファクトリと serializer / deserializer / 型ガードを取り込み
import { createAppError, deserializeAppError, isAppError, isSerializedAppError, serializeError } from "./index.js";

// serializeError の挙動を検証する
describe("serializeError", () => {
  // cause は意図的に除外される
  it("omits cause from the serialized output", () => {
    const cause = new Error("inner");
    const error = createAppError({ kind: "system", message: "boom", cause });

    const serialized = serializeError(error);

    // name は SerializedAppError 固定（AppError との区別キー）
    expect(serialized.name).toBe("SerializedAppError");
    expect(serialized.kind).toBe("system");
    expect(serialized.message).toBe("boom");
    expect((serialized as { cause?: unknown }).cause).toBeUndefined();
  });

  // optional フィールドが無くてもキー欠落のまま伝播する
  it("propagates optional fields as-is", () => {
    const error = createAppError({
      kind: "http",
      code: "X",
      status: 500,
      requestId: "req-1",
      traceId: "trace-1",
      details: { foo: 1 },
      validationIssues: [{ message: "x" }],
      context: { operation: "save" },
    });

    const serialized = serializeError(error);

    expect(serialized.code).toBe("X");
    expect(serialized.status).toBe(500);
    expect(serialized.requestId).toBe("req-1");
    expect(serialized.traceId).toBe("trace-1");
    expect(serialized.details).toEqual({ foo: 1 });
    expect(serialized.validationIssues).toEqual([{ message: "x" }]);
    expect(serialized.context).toEqual({ operation: "save" });
    expect(serialized.retryable).toBe(error.retryable);
    expect(serialized.reportable).toBe(error.reportable);
    expect(serialized.severity).toBe(error.severity);
  });

  // 出力は JSON 化可能（循環参照なし）
  it("is JSON-stringifiable", () => {
    const error = createAppError({ kind: "validation", message: "v" });
    expect(() => JSON.stringify(serializeError(error))).not.toThrow();
  });

  // serializeError の出力は isAppError では false、isSerializedAppError で true
  it("can be discriminated from AppError via guards", () => {
    // AppError を 1 件作って serialize する
    const error = createAppError({ kind: "system", message: "boom" });
    const serialized = serializeError(error);

    // isAppError は serialized を弾く（name が異なるため）
    expect(isAppError(serialized)).toBe(false);
    // isSerializedAppError は serialized を受け入れる
    expect(isSerializedAppError(serialized)).toBe(true);
  });
});

// deserializeAppError の挙動を検証する
describe("deserializeAppError", () => {
  // 往復で kind / 各フィールドが保たれる
  it("restores AppError from SerializedAppError", () => {
    const original = createAppError({
      kind: "http",
      message: "boom",
      code: "X",
      status: 500,
      requestId: "req-1",
      traceId: "trace-1",
      details: { foo: 1 },
      validationIssues: [{ message: "x" }],
      context: { operation: "save" },
    });
    // 1 度シリアライズして再復元する
    const restored = deserializeAppError(serializeError(original));

    // name は AppError に戻り、isAppError で識別可能になる
    expect(restored.name).toBe("AppError");
    expect(isAppError(restored)).toBe(true);
    // 値は変化していない
    expect(restored.kind).toBe(original.kind);
    expect(restored.message).toBe(original.message);
    expect(restored.code).toBe(original.code);
    expect(restored.status).toBe(original.status);
    expect(restored.requestId).toBe(original.requestId);
    expect(restored.traceId).toBe(original.traceId);
    expect(restored.details).toEqual(original.details);
    expect(restored.validationIssues).toEqual(original.validationIssues);
    expect(restored.context).toEqual(original.context);
    expect(restored.retryable).toBe(original.retryable);
    expect(restored.reportable).toBe(original.reportable);
    expect(restored.severity).toBe(original.severity);
  });

  // cause は serialize 時に落とされるため、復元時に明示渡しできる
  it("re-attaches cause when supplied via options", () => {
    // 元の AppError には cause を持たせるが、serialize で落ちる
    const original = createAppError({ kind: "system", message: "boom", cause: new Error("inner") });
    const serialized = serializeError(original);
    // 復元時に新しい cause を明示渡しできる
    const replacement = new Error("replacement cause");
    const restored = deserializeAppError(serialized, { cause: replacement });
    expect(restored.cause).toBe(replacement);
  });

  // options 未指定なら cause は undefined のままで復元される
  it("leaves cause undefined when options are omitted", () => {
    const original = createAppError({ kind: "system", message: "boom", cause: new Error("inner") });
    const serialized = serializeError(original);
    // options を渡さずに復元
    const restored = deserializeAppError(serialized);
    expect(restored.cause).toBeUndefined();
  });
});
