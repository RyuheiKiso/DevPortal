// vitest API を取り込み
import { afterEach, describe, expect, it, vi } from "vitest";
// 対象モジュール
import { createDefaultIdFactory, fallbackId } from "./id.js";

// globalThis.crypto は getter のみのプロパティの可能性があるため
// Object.defineProperty を使って一時的に上書きする
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

// 一時的に crypto を差し替えるヘルパ
function setCrypto(value: unknown): void {
  // defineProperty で writable な状態にする
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    writable: true,
    enumerable: true,
    value,
  });
}

// crypto.randomUUID が使えるかでファクトリの挙動が変わることを検証
describe("createDefaultIdFactory", () => {
  // 各テスト後に元に戻す
  afterEach(() => {
    // 元の descriptor を復元
    if (originalCryptoDescriptor !== undefined) {
      Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
    } else {
      // 元々無かった場合は削除
      delete (globalThis as { crypto?: unknown }).crypto;
    }
  });

  // crypto.randomUUID が使える環境
  it("uses crypto.randomUUID when available", () => {
    // mock crypto を設定
    const mockUuid = vi.fn().mockReturnValue("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    setCrypto({ randomUUID: mockUuid });
    // factory を生成
    const factory = createDefaultIdFactory();
    // 呼び出し結果がモック戻り値と一致
    expect(factory()).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(mockUuid).toHaveBeenCalledTimes(1);
  });

  // crypto.randomUUID が無い環境
  it("falls back to fallbackId when randomUUID is missing", () => {
    // crypto を空オブジェクトに置換 (randomUUID なし)
    setCrypto({});
    // factory 生成
    const factory = createDefaultIdFactory();
    // 戻り値は fallbackId 形式 (8-4-4-4-12)
    const id = factory();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // crypto 自体が undefined の環境
  it("falls back when globalThis.crypto is undefined", () => {
    // 削除
    setCrypto(undefined);
    // factory 生成
    const factory = createDefaultIdFactory();
    // 戻り値は fallbackId
    expect(factory()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// fallbackId 単体動作
describe("fallbackId", () => {
  // フォーマットを検証
  it("returns UUID-like format", () => {
    // 戻り値の形式
    const id = fallbackId();
    // 8-4-4-4-12 形式
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // 連続呼び出しで通常異なる ID を返す
  it("returns different IDs on consecutive calls (statistically)", () => {
    // 連続呼び出し
    const a = fallbackId();
    const b = fallbackId();
    // 衝突確率は極めて低いので異なるはず
    expect(a).not.toBe(b);
  });
});
