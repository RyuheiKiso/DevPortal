// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// 公開 API 経由で createAppError を取り込み
import { createAppError, defaultReportable, defaultRetryable, defaultSeverity, defaultUserMessage } from "./index.js";

// AppError ファクトリの動作を検証する
describe("createAppError", () => {
  // 何も渡さなければ kind 既定の値で AppError が組み立てられる
  it("uses kind-derived defaults when fields are omitted", () => {
    // validation kind は warning + retryable false + reportable false が既定
    const error = createAppError({ kind: "validation" });

    // name は常に AppError 固定（type guard で利用）
    expect(error.name).toBe("AppError");
    // 各フィールドが kind 既定値と一致することを確認
    expect(error.kind).toBe("validation");
    expect(error.userMessage).toBe(defaultUserMessage("validation"));
    expect(error.message).toBe(defaultUserMessage("validation"));
    expect(error.severity).toBe(defaultSeverity("validation"));
    expect(error.retryable).toBe(defaultRetryable("validation"));
    expect(error.reportable).toBe(defaultReportable("validation"));
  });

  // message を明示すれば userMessage と別の値が使われる
  it("keeps message and userMessage independent when both are supplied", () => {
    // 内部メッセージはログ用、userMessage はユーザー表示用
    const error = createAppError({
      kind: "business",
      message: "Internal log line",
      userMessage: "Friendly text",
    });

    expect(error.message).toBe("Internal log line");
    expect(error.userMessage).toBe("Friendly text");
  });

  // status を指定すると retryable は HTTP セマンティクスで上書きされる
  it("derives retryable from kind+status", () => {
    // 5xx は retryable=true
    const system = createAppError({ kind: "system", status: 503 });
    expect(system.retryable).toBe(true);
    expect(system.reportable).toBe(true);

    // status 単独 200 は retryable=false（kind business のため）
    const business = createAppError({ kind: "business", status: 200 });
    expect(business.retryable).toBe(false);
  });

  // 明示指定された retryable / reportable / severity は既定値を上書きする
  it("honors explicit overrides for retryable, reportable, severity", () => {
    // 既定では reportable=false の validation を強制的に通報対象にする
    const error = createAppError({
      kind: "validation",
      retryable: true,
      reportable: true,
      severity: "critical",
    });

    expect(error.retryable).toBe(true);
    expect(error.reportable).toBe(true);
    expect(error.severity).toBe("critical");
  });

  // 任意フィールド (code/status/requestId/traceId/details/cause/validationIssues/context) は素通し
  it("passes through optional fields unchanged", () => {
    // それぞれのフィールドに識別可能な値を入れて素通しを検証
    const cause = new Error("inner");
    const error = createAppError({
      kind: "http",
      code: "CODE_X",
      status: 400,
      requestId: "req-1",
      traceId: "trace-1",
      details: { foo: "bar" },
      cause,
      validationIssues: [{ message: "issue" }],
      context: { operation: "op-1" },
    });

    expect(error.code).toBe("CODE_X");
    expect(error.status).toBe(400);
    expect(error.requestId).toBe("req-1");
    expect(error.traceId).toBe("trace-1");
    expect(error.details).toEqual({ foo: "bar" });
    expect(error.cause).toBe(cause);
    expect(error.validationIssues).toEqual([{ message: "issue" }]);
    expect(error.context?.operation).toBe("op-1");
  });
});
