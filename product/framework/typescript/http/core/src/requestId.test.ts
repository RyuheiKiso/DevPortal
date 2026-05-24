// vitest DSL を取り込み
import { afterEach, describe, expect, it, vi } from "vitest";
// テスト対象
import { REQUEST_ID_HEADER, createRequestId } from "./requestId.js";

describe("REQUEST_ID_HEADER", () => {
  // 標準ヘッダ名
  it("X-Request-Id 固定", () => {
    expect(REQUEST_ID_HEADER).toBe("X-Request-Id");
  });
});

describe("createRequestId", () => {
  // 各テスト後に stub を解除
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  // randomUUID が存在する環境（vitest 既定の Node 18+）
  it("crypto.randomUUID があればそれを使う", () => {
    const fn = vi.fn(() => "fake-uuid");
    vi.stubGlobal("crypto", { randomUUID: fn });
    expect(createRequestId()).toBe("fake-uuid");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  // randomUUID が無い環境（古い Node / 限定的ブラウザ）
  it("crypto.randomUUID が無ければフォールバック ID を返す", () => {
    vi.stubGlobal("crypto", {});
    const id = createRequestId();
    // フォールバック形式は "<base36>-<base36>" の 2 つのトークン
    expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]{1,8}$/);
  });
  // crypto 自体が未定義の環境
  it("crypto 自体が undefined でもフォールバックで生成", () => {
    vi.stubGlobal("crypto", undefined);
    const id = createRequestId();
    expect(id.length).toBeGreaterThan(0);
  });
});
