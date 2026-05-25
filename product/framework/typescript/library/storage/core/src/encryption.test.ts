// vitest API を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { createAesGcmProvider, withEncryption } from "./encryption.js";
// メモリストア
import { createMemoryStore } from "./memory.js";
// codec ファクトリ
import { jsonCodec } from "./codec.js";
// 公開型
import type { CryptoProvider, KvStore } from "./types.js";

// 平文をそのまま base64 風に偽暗号化する mock provider (テスト用)
// 実暗号化が無くてもラッパの正当性を検証できる
function createMockProvider(): CryptoProvider {
  return {
    async encrypt(plaintext, _aad) {
      // ciphertext は plaintext そのもの、IV はダミー固定
      return { ciphertext: new Uint8Array(plaintext), iv: new Uint8Array([1, 2, 3, 4]) };
    },
    async decrypt(payload, _aad) {
      // ciphertext をそのまま plaintext として返す
      return new Uint8Array(payload.ciphertext);
    },
  };
}

// withEncryption の網羅テスト
describe("withEncryption", () => {
  // 既定 codec (stringCodec) で string 値を round-trip
  it("round-trips a string using the default codec", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withEncryption<string>({ provider: createMockProvider() })(inner);
    await wrapped.set("k", "hello");
    await expect(wrapped.get("k")).resolves.toBe("hello");
  });
  // jsonCodec で構造体を round-trip
  it("round-trips a JSON value with json codec", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withEncryption<{ a: number }>({
      provider: createMockProvider(),
      codec: jsonCodec<{ a: number }>(),
    })(inner);
    await wrapped.set("k", { a: 1 });
    await expect(wrapped.get("k")).resolves.toEqual({ a: 1 });
  });
  // 未保存 get → undefined
  it("returns undefined for missing keys", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withEncryption<string>({ provider: createMockProvider() })(inner);
    await expect(wrapped.get("nope")).resolves.toBeUndefined();
  });
  // バージョン不一致は throw
  it("throws when envelope version is unknown", async () => {
    const inner = createMemoryStore<string>();
    // 不正バージョンのエンベロープを直接書き込む
    await inner.set("k", JSON.stringify({ v: 99, iv: "AAEC", ct: "AAEC" }));
    const wrapped = withEncryption<string>({ provider: createMockProvider() })(inner);
    let thrown: unknown;
    try {
      await wrapped.get("k");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
  });
  // AAD あり経路
  it("passes AAD when aadFromKey is true", async () => {
    const inner = createMemoryStore<string>();
    // AAD を受け取ったかを確認するためにフラグを立てる provider
    let lastAad: Uint8Array | undefined;
    const provider: CryptoProvider = {
      async encrypt(plaintext, aad) {
        lastAad = aad;
        return { ciphertext: new Uint8Array(plaintext), iv: new Uint8Array([1, 2, 3, 4]) };
      },
      async decrypt(payload, _aad) {
        return new Uint8Array(payload.ciphertext);
      },
    };
    const wrapped = withEncryption<string>({ provider, aadFromKey: true })(inner);
    await wrapped.set("auth", "secret");
    // AAD はキー名のバイト列
    expect(lastAad).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(lastAad)).toBe("auth");
  });
  // AAD なし経路 (aadFromKey 未指定)
  it("passes no AAD when aadFromKey is false", async () => {
    const inner = createMemoryStore<string>();
    let lastAad: Uint8Array | undefined;
    const provider: CryptoProvider = {
      async encrypt(plaintext, aad) {
        lastAad = aad;
        return { ciphertext: new Uint8Array(plaintext), iv: new Uint8Array([1, 2, 3, 4]) };
      },
      async decrypt(payload) {
        return new Uint8Array(payload.ciphertext);
      },
    };
    const wrapped = withEncryption<string>({ provider })(inner);
    await wrapped.set("k", "v");
    expect(lastAad).toBeUndefined();
  });
  // remove 素通し
  it("remove delegates to inner", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withEncryption<string>({ provider: createMockProvider() })(inner);
    await wrapped.set("k", "v");
    await wrapped.remove("k");
    await expect(inner.get("k")).resolves.toBeUndefined();
  });
  // 任意機能の素通し
  it("propagates has / keys / clear when inner provides them", async () => {
    const inner = createMemoryStore<string>();
    const wrapped = withEncryption<string>({ provider: createMockProvider() })(inner);
    await wrapped.set("k", "v");
    await expect(wrapped.has?.("k")).resolves.toBe(true);
    await expect(wrapped.keys?.()).resolves.toEqual(["k"]);
    await wrapped.clear?.();
    await expect(wrapped.keys?.()).resolves.toEqual([]);
  });
  // 任意機能が無い inner では wrapped にも提供されない
  it("does not expose optional methods when inner lacks them", () => {
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const wrapped = withEncryption<string>({ provider: createMockProvider() })(inner);
    expect(wrapped.has).toBeUndefined();
    expect(wrapped.keys).toBeUndefined();
    expect(wrapped.clear).toBeUndefined();
  });
});

// createAesGcmProvider の Web Crypto 経路テスト
describe("createAesGcmProvider", () => {
  // 鍵を生成する内部ヘルパ
  async function importKey(): Promise<CryptoKey> {
    // 32 バイト (= 256bit) のランダム鍵を直接 importKey する
    const raw = crypto.getRandomValues(new Uint8Array(32));
    // AES-GCM 用の CryptoKey として importKey
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }
  // round-trip
  it("encrypts and decrypts a payload", async () => {
    const key = await importKey();
    const provider = createAesGcmProvider({ key });
    const plaintext = new TextEncoder().encode("hello world");
    const { ciphertext, iv } = await provider.encrypt(plaintext);
    // 暗号文は平文と異なる
    expect(ciphertext).not.toEqual(plaintext);
    // IV は 12 バイト
    expect(iv.length).toBe(12);
    // 復号で復元
    const decrypted = await provider.decrypt({ ciphertext, iv });
    expect(new TextDecoder().decode(decrypted)).toBe("hello world");
  });
  // AAD 込み round-trip
  it("supports AAD on encrypt and decrypt", async () => {
    const key = await importKey();
    const provider = createAesGcmProvider({ key });
    const plaintext = new TextEncoder().encode("secret");
    const aad = new TextEncoder().encode("key:auth");
    const { ciphertext, iv } = await provider.encrypt(plaintext, aad);
    // 同一 AAD で復号できる
    const decrypted = await provider.decrypt({ ciphertext, iv }, aad);
    expect(new TextDecoder().decode(decrypted)).toBe("secret");
  });
  // AAD 不一致で復号失敗
  it("fails decrypt when AAD differs", async () => {
    const key = await importKey();
    const provider = createAesGcmProvider({ key });
    const plaintext = new TextEncoder().encode("secret");
    const aad = new TextEncoder().encode("key:auth");
    const { ciphertext, iv } = await provider.encrypt(plaintext, aad);
    // 別 AAD では復号が拒否される (OperationError)
    let thrown: unknown;
    try {
      await provider.decrypt({ ciphertext, iv }, new TextEncoder().encode("key:other"));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
  });
});
