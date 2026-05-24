// vitest DSL を取り込み
import { afterEach, describe, expect, it, vi } from "vitest";
// テスト対象
import { createDefaultIdFactory, fallbackId } from "./id.js";

// globalThis.crypto を一時退避するための変数
let originalCrypto: unknown;

describe("id", () => {
  // 各テスト後に globalThis.crypto を元に戻す
  afterEach(() => {
    // 退避があれば復元
    if (originalCrypto !== undefined) {
      // crypto を上書きで戻す
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
      // 退避をクリア
      originalCrypto = undefined;
    }
  });

  // crypto.randomUUID が利用可能ならそれを使う
  it("crypto.randomUUID が利用可能なら crypto.randomUUID を呼ぶ", () => {
    // 現在の crypto を退避
    originalCrypto = (globalThis as { crypto?: unknown }).crypto;
    // モックを定義（randomUUID は固定値を返す）
    const stub = { randomUUID: vi.fn(() => "fixed-uuid") };
    Object.defineProperty(globalThis, "crypto", {
      value: stub,
      configurable: true,
      writable: true,
    });
    // ファクトリを生成
    const next = createDefaultIdFactory();
    // 戻り値はモックの返却値
    expect(next()).toBe("fixed-uuid");
    // 呼び出された
    expect(stub.randomUUID).toHaveBeenCalledTimes(1);
  });

  // randomUUID が未対応のときは fallbackId を使う
  it("crypto.randomUUID が無いときは Math.random ベースの ID を返す", () => {
    // 現在の crypto を退避
    originalCrypto = (globalThis as { crypto?: unknown }).crypto;
    // crypto.randomUUID 無しの状態に書き換える
    Object.defineProperty(globalThis, "crypto", {
      value: {},
      configurable: true,
      writable: true,
    });
    // ファクトリを生成
    const next = createDefaultIdFactory();
    // 戻り値は UUID v4 風の形式（8-4-4-4-12）
    const id = next();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // crypto そのものが存在しないとき
  it("crypto が undefined でも fallback を返す", () => {
    // 現在の crypto を退避
    originalCrypto = (globalThis as { crypto?: unknown }).crypto;
    // crypto を取り除く
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    // ファクトリを生成
    const next = createDefaultIdFactory();
    // 形式チェック
    expect(next()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // fallbackId 直接呼び出しでも整形済み ID を返す
  it("fallbackId は UUID v4 風の形式を返す", () => {
    expect(fallbackId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
