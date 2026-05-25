// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// 公開 API 経由で関連関数を取り込み
import { createAppError, toLogRecord, toNotification } from "./index.js";

// toLogRecord の挙動を検証する
describe("toLogRecord", () => {
  // 必要フィールドが全て揃って出力される
  it("includes the standard log fields", () => {
    const error = createAppError({
      kind: "system",
      message: "boom",
      userMessage: "system fail",
      code: "X",
      status: 500,
      requestId: "req-1",
      traceId: "trace-1",
      details: { detail: 1 },
      validationIssues: [{ message: "issue" }],
      context: { operation: "save" },
    });

    const log = toLogRecord(error);

    expect(log.errorName).toBe("AppError");
    expect(log.kind).toBe("system");
    expect(log.severity).toBe("critical");
    expect(log.message).toBe("boom");
    expect(log.userMessage).toBe("system fail");
    expect(log.code).toBe("X");
    expect(log.status).toBe(500);
    expect(log.requestId).toBe("req-1");
    expect(log.traceId).toBe("trace-1");
    expect(log.retryable).toBe(true);
    expect(log.reportable).toBe(true);
    expect(log.details).toEqual({ detail: 1 });
    expect(log.validationIssues).toEqual([{ message: "issue" }]);
    expect(log.context?.operation).toBe("save");
    // cause はログに含めない契約
    expect((log as { cause?: unknown }).cause).toBeUndefined();
  });
});

// toNotification の挙動を検証する（severity / kind 分岐網羅）
describe("toNotification", () => {
  // info severity は info level
  it("maps info severity to info level", () => {
    const notification = toNotification(createAppError({ kind: "business", severity: "info" }));
    expect(notification.level).toBe("info");
  });

  // warning severity は warning level
  it("maps warning severity to warning level", () => {
    const notification = toNotification(createAppError({ kind: "validation" }));
    expect(notification.level).toBe("warning");
  });

  // critical severity も error level に圧縮
  it("maps critical severity to error level", () => {
    const notification = toNotification(createAppError({ kind: "system" }));
    expect(notification.level).toBe("error");
  });

  // 通常の error severity は error level
  it("maps error severity to error level", () => {
    const notification = toNotification(createAppError({ kind: "auth" }));
    expect(notification.level).toBe("error");
  });

  // validation 系はタイトル「Input error」
  it("uses Input error title for validation", () => {
    const notification = toNotification(createAppError({ kind: "validation" }));
    expect(notification.title).toBe("Input error");
  });

  // それ以外はタイトル「Error」
  it("uses Error title for non-validation kinds", () => {
    const notification = toNotification(createAppError({ kind: "system" }));
    expect(notification.title).toBe("Error");
  });

  // dedupeKey は code が優先、無ければ kind
  it("uses code as dedupeKey when present, otherwise kind", () => {
    const withCode = toNotification(createAppError({ kind: "validation", code: "DUPE_KEY" }));
    expect(withCode.dedupeKey).toBe("DUPE_KEY");
    const withoutCode = toNotification(createAppError({ kind: "validation" }));
    expect(withoutCode.dedupeKey).toBe("validation");
  });

  // message は userMessage を採用
  it("uses userMessage as the notification message", () => {
    const notification = toNotification(createAppError({ kind: "system", userMessage: "user text" }));
    expect(notification.message).toBe("user text");
  });

  // kind は常に toast
  it("always uses toast kind", () => {
    const notification = toNotification(createAppError({ kind: "system" }));
    expect(notification.kind).toBe("toast");
  });
});
