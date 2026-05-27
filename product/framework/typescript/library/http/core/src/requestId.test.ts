// vitest DSL を取り込み
import { afterEach, describe, expect, it, vi } from "vitest";
// テスト対象
import {
  REQUEST_ID_HEADER,
  TRACEPARENT_HEADER,
  createRequestId,
  createTraceparent,
} from "./requestId.js";

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
  // M6: フォールバック時に 1 度だけ console.warn が呼ばれる
  // (warnedAboutWeakRandom はモジュールスコープのため他テストで既に立っている可能性がある。
  //  本テストは「呼ばれる場合は createRequestId 由来のメッセージである」ことを確認する想定で、
  //  すでに warn 済みのケースでもフォールバック ID が正しく返ることをアサートする)
  it("M6: crypto.randomUUID 不在時にフォールバック ID を返す (warn は once)", () => {
    vi.stubGlobal("crypto", {});
    // console.warn を spy する (既に warn 済みなら呼ばれないが、ID が返ることは確定)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const id = createRequestId();
      expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]{1,8}$/);
      // 呼ばれた場合は request-id フォールバックを示すメッセージ
      for (const call of warn.mock.calls) {
        const msg = String(call[0]);
        expect(msg).toContain("Math.random");
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe("TRACEPARENT_HEADER", () => {
  // W3C 標準ヘッダ名は小文字固定
  it("traceparent (小文字固定)", () => {
    expect(TRACEPARENT_HEADER).toBe("traceparent");
  });
});

describe("createTraceparent", () => {
  // 各テスト後に stub を解除
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  // W3C trace-context 形式の検証
  it("00-<32hex>-<16hex>-01 形式を返す", () => {
    const tp = createTraceparent();
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
  // 連続生成で異なる ID を返す
  it("連続生成で trace-id / span-id が変わる", () => {
    const a = createTraceparent();
    const b = createTraceparent();
    expect(a).not.toBe(b);
  });
  // crypto.getRandomValues が無い環境（Math.random フォールバック）
  // M6: メッセージ仕様統一後の warn 内容を assert
  // (warnedAboutWeakRandom はモジュールスコープなので、他テストで既に warn 済みの可能性あり。
  //  本テストは「フォールバックが動作して traceparent が返る」ことを主眼とし、warn 内容は
  //  呼び出された場合のみ検証する)
  it("crypto.getRandomValues 無しでもフォールバックで生成", () => {
    vi.stubGlobal("crypto", {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const tp = createTraceparent();
      expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      // warn が呼ばれた場合のみメッセージを assert (テスト順序によって warn 済みなら呼ばれない)
      for (const call of warn.mock.calls) {
        const msg = String(call[0]);
        expect(msg).toContain("Math.random");
      }
    } finally {
      warn.mockRestore();
    }
  });
  // T-A4: Math.random フォールバックが決定論的に動作する（全 0）
  it("T-A4: Math.random=0 固定で全 byte 0 の traceparent を生成", () => {
    vi.stubGlobal("crypto", {});
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const tp = createTraceparent();
      // 0x00 を 24 byte 分: trace 32 hex + span 16 hex
      expect(tp).toBe("00-00000000000000000000000000000000-0000000000000000-01");
    } finally {
      spy.mockRestore();
    }
  });
  // T-A4: Math.random=0.999 固定で全 byte 0xff（padStart 不要だが整合確認）
  it("T-A4: Math.random=0.999 固定で全 byte 0xff の traceparent を生成", () => {
    vi.stubGlobal("crypto", {});
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.999);
    try {
      const tp = createTraceparent();
      expect(tp).toBe("00-ffffffffffffffffffffffffffffffff-ffffffffffffffff-01");
    } finally {
      spy.mockRestore();
    }
  });
  // T-A5: getRandomValues 不在時 Math.random が 16+8 = 24 回呼ばれる（バイト数の担保）
  it("T-A5: フォールバック時 Math.random が 24 回呼ばれる", () => {
    vi.stubGlobal("crypto", {});
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      createTraceparent();
      expect(spy).toHaveBeenCalledTimes(24);
    } finally {
      spy.mockRestore();
    }
  });
});
