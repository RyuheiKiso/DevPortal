// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import {
  GRPC_STATUS_NAMES,
  RETRYABLE_GRPC_CODES,
  grpcStatusToHttpError,
} from "./errors.js";

describe("GRPC_STATUS_NAMES", () => {
  // 既知コードのマッピング
  it("代表的なステータス名を含む", () => {
    expect(GRPC_STATUS_NAMES[4]).toBe("DEADLINE_EXCEEDED");
    expect(GRPC_STATUS_NAMES[14]).toBe("UNAVAILABLE");
    expect(GRPC_STATUS_NAMES[16]).toBe("UNAUTHENTICATED");
  });
});

describe("RETRYABLE_GRPC_CODES", () => {
  // 標準的な一時障害コード
  it("UNAVAILABLE / DEADLINE_EXCEEDED / RESOURCE_EXHAUSTED を含む", () => {
    expect(RETRYABLE_GRPC_CODES).toEqual([4, 8, 14]);
  });
});

describe("grpcStatusToHttpError", () => {
  // 既知コードは name に変換、retryable は true
  it("UNAVAILABLE は retryable=true / code=UNAVAILABLE", () => {
    const e = grpcStatusToHttpError({ code: 14, message: "unav" }, "rid");
    expect(e.code).toBe("UNAVAILABLE");
    expect(e.retryable).toBe(true);
    expect(e.requestId).toBe("rid");
    expect(e.message).toBe("unav");
  });
  // 既知コードだが retryable=false
  it("PERMISSION_DENIED は retryable=false", () => {
    const e = grpcStatusToHttpError({ code: 7, message: "no" }, "rid");
    expect(e.code).toBe("PERMISSION_DENIED");
    expect(e.retryable).toBe(false);
  });
  // 未知コードは GRPC_<code> 名で返す
  it("未知コードは GRPC_<code> として返す", () => {
    const e = grpcStatusToHttpError({ code: 99, message: "?" }, "rid");
    expect(e.code).toBe("GRPC_99");
    expect(e.retryable).toBe(false);
  });
});
