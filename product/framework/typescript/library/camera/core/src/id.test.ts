// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// テスト対象
import { createDefaultIdFactory, fallbackId } from "./id.js";

// テスト終了ごとに global を復元する
afterEach(() => {
  // crypto を必要に応じて差し戻す（モック後の delete を防ぐ）
  vi.unstubAllGlobals();
});

describe("createDefaultIdFactory", () => {
  it("crypto.randomUUID があるときはそれを使う", () => {
    // ダミー UUID を返す randomUUID を仕込む
    const stub = { randomUUID: vi.fn().mockReturnValue("uuid-123") };
    vi.stubGlobal("crypto", stub);
    // factory を生成
    const factory = createDefaultIdFactory();
    expect(factory()).toBe("uuid-123");
    expect(stub.randomUUID).toHaveBeenCalled();
  });

  it("crypto が undefined のときは fallbackId に切り替わる", () => {
    // crypto を未定義に
    vi.stubGlobal("crypto", undefined);
    const factory = createDefaultIdFactory();
    // fallbackId は UUID v4 形式
    expect(factory()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("crypto.randomUUID が関数でない場合は fallbackId に切り替わる", () => {
    // randomUUID が string になっているケース
    vi.stubGlobal("crypto", { randomUUID: "not-a-function" });
    const factory = createDefaultIdFactory();
    expect(factory()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("fallbackId", () => {
  it("UUID v4 風の形式を返す", () => {
    const id = fallbackId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("Math.random が 0 を返す境界でも形式が崩れない", () => {
    // 全 0 にすると padStart で 0 埋めパスが通る
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(fallbackId()).toBe("00000000-0000-0000-0000-000000000000");
    } finally {
      spy.mockRestore();
    }
  });
});
