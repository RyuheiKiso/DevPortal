// vitest DSL を取り込み
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// テスト対象を取り込み
import { createEncryptedWebTokenStore } from "./encryptedStorage.js";
// storage 型を共有する (storage.test.ts と同形)
import type { WebKeyValueStorage } from "./storage.js";
// CryptoProvider 型と AES-GCM ファクトリ
import type { CryptoProvider } from "@k1s0-ts-storage/core";
import { createAesGcmProvider } from "@k1s0-ts-storage/core";

// fake storage を作るヘルパ (Map ベース、テストでバッキングを観察できるよう公開)
function createFakeStorage(): WebKeyValueStorage & { backing: Map<string, string> } {
  // バッキング Map
  const backing = new Map<string, string>();
  // 最小 API を実装して返す
  return {
    // バッキング参照 (アサーション用)
    backing,
    // get
    getItem(key: string): string | null {
      // Map の値を取り出す
      const value = backing.get(key);
      // undefined を null に変換
      return value === undefined ? null : value;
    },
    // set
    setItem(key: string, value: string): void {
      // Map に保存
      backing.set(key, value);
    },
    // delete
    removeItem(key: string): void {
      // Map から削除
      backing.delete(key);
    },
  };
}

// 32 バイトのランダム鍵から AES-GCM CryptoKey を生成する
async function importTestKey(): Promise<CryptoKey> {
  // 256bit ランダム鍵を生成
  const raw = crypto.getRandomValues(new Uint8Array(32));
  // AES-GCM 用に importKey
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// 復号失敗系のテストで使うモック CryptoProvider (identity 風: ciphertext = plaintext)
// envelope/ciphertext を意図的に偽装したテストを書くために使う
function createIdentityProvider(): CryptoProvider {
  return {
    // 入力をそのまま暗号文として返す (IV は固定 12 バイト 0)
    async encrypt(plaintext, _aad) {
      return { ciphertext: new Uint8Array(plaintext), iv: new Uint8Array(12) };
    },
    // 入力をそのまま平文として返す (AAD 無視)
    async decrypt(payload, _aad) {
      return new Uint8Array(payload.ciphertext);
    },
  };
}

// バイト列を base64 文字列に変換する (テスト用、storage/core 内のものと同等)
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

// createEncryptedWebTokenStore のテスト
describe("createEncryptedWebTokenStore", () => {
  // window 環境を退避・復元する
  let savedDescriptor: PropertyDescriptor | undefined;
  beforeEach(() => {
    // 元の window descriptor を退避
    savedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  });
  afterEach(() => {
    // 元の window を戻す (テスト間で漏れないように)
    if (savedDescriptor === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, "window", savedDescriptor);
    }
  });

  // 実 AES-GCM での round-trip
  it("AES-GCM で round-trip できる (set → get → clear)", async () => {
    // 実鍵を生成
    const key = await importTestKey();
    // provider 生成
    const provider = createAesGcmProvider({ key });
    // fake storage
    const storage = createFakeStorage();
    // store を作る
    const store = createEncryptedWebTokenStore({ provider, storage });
    // 初期状態は undefined
    expect(await store.get()).toBeUndefined();
    // 保存
    await store.set({ accessToken: "secret-token", refreshToken: "r" });
    // 保存内容は平文 JSON ではないこと (暗号化されている)
    const stored = storage.backing.get("k1s0.auth.tokens");
    // 何かしら格納されていること
    expect(stored).toBeDefined();
    // 平文を含んでいないこと (秘密がそのまま見えていないこと)
    expect(stored).not.toContain("secret-token");
    // envelope 形式 (v/iv/ct を含む JSON) であること
    expect(stored).toContain('"v":');
    expect(stored).toContain('"iv":');
    expect(stored).toContain('"ct":');
    // get で復号できること
    expect(await store.get()).toEqual({ accessToken: "secret-token", refreshToken: "r" });
    // clear で削除されること
    await store.clear();
    // バッキングから消えていること
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // SSR (window 未定義) ではメモリにフォールバック
  it("window 未定義 (SSR) ではメモリ実装にフォールバックする", async () => {
    // window を削除する (SSR シミュ)
    delete (globalThis as { window?: unknown }).window;
    // 実鍵を生成
    const key = await importTestKey();
    const provider = createAesGcmProvider({ key });
    // storage を渡さずに作る (既定で window.localStorage を見にいくが、無いのでフォールバック)
    const store = createEncryptedWebTokenStore({ provider });
    // メモリ動作: 初期は undefined
    expect(await store.get()).toBeUndefined();
    // 保存できる
    await store.set({ accessToken: "x" });
    // 同インスタンス内では取得できる
    expect(await store.get()).toEqual({ accessToken: "x" });
  });

  // window.localStorage が null の場合もメモリにフォールバック
  it("window.localStorage が null でもメモリ実装にフォールバックする", async () => {
    // localStorage = null を持つ window を定義
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: null },
      configurable: true,
    });
    // store を作る
    const key = await importTestKey();
    const provider = createAesGcmProvider({ key });
    const store = createEncryptedWebTokenStore({ provider });
    // メモリ動作 (throw せず undefined)
    expect(await store.get()).toBeUndefined();
  });

  // window.localStorage 参照で throw する環境でもフォールバック
  it("window.localStorage 参照が throw する環境でもフォールバックする", async () => {
    // localStorage getter で throw する window を定義
    const fakeWindow: Record<string, unknown> = {};
    Object.defineProperty(fakeWindow, "localStorage", {
      get() {
        throw new Error("denied");
      },
      configurable: true,
    });
    // globalThis.window に差し込む
    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    // store を作る
    const key = await importTestKey();
    const provider = createAesGcmProvider({ key });
    const store = createEncryptedWebTokenStore({ provider });
    // メモリ動作 (throw せず undefined)
    expect(await store.get()).toBeUndefined();
  });

  // 既定 window.localStorage を採用できること
  it("window.localStorage を既定値として利用する", async () => {
    // fake storage を window.localStorage として注入
    const fake = createFakeStorage();
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: fake },
      configurable: true,
    });
    // store を作る
    const key = await importTestKey();
    const provider = createAesGcmProvider({ key });
    const store = createEncryptedWebTokenStore({ provider });
    // 保存
    await store.set({ accessToken: "from-default" });
    // 既定キーで fake storage に書かれていること
    expect(fake.backing.has("k1s0.auth.tokens")).toBe(true);
  });

  // カスタムキーを指定できること
  it("key オプションで保存キーを変えられる", async () => {
    const key = await importTestKey();
    const provider = createAesGcmProvider({ key });
    const storage = createFakeStorage();
    // カスタムキーを指定
    const store = createEncryptedWebTokenStore({ provider, storage, key: "custom:tokens" });
    await store.set({ accessToken: "a" });
    // 指定キーで保存されていること
    expect(storage.backing.has("custom:tokens")).toBe(true);
    // 既定キーには書かれていないこと
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // 復号失敗 (鍵不一致) → onCorrupt + cleanup
  it("鍵不一致で復号失敗時に onCorrupt が呼ばれ破損データが削除される", async () => {
    // 鍵 1 で保存
    const k1 = await importTestKey();
    const p1 = createAesGcmProvider({ key: k1 });
    const storage = createFakeStorage();
    const store1 = createEncryptedWebTokenStore({ provider: p1, storage });
    await store1.set({ accessToken: "secret" });
    // 鍵 2 で読み込む (別 provider)
    const k2 = await importTestKey();
    const p2 = createAesGcmProvider({ key: k2 });
    // onCorrupt スパイ
    const onCorrupt = vi.fn();
    const store2 = createEncryptedWebTokenStore({ provider: p2, storage, onCorrupt });
    // 復号失敗 → undefined
    expect(await store2.get()).toBeUndefined();
    // onCorrupt が呼ばれていること
    expect(onCorrupt).toHaveBeenCalledTimes(1);
    // 破損データが削除されていること
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // 復号成功後の JSON.parse 失敗 → onCorrupt + cleanup
  it("復号後の平文が JSON でないと onCorrupt が呼ばれ破損データが削除される", async () => {
    // identity provider で envelope を直接組み立てて仕込む
    const provider = createIdentityProvider();
    const storage = createFakeStorage();
    // 平文として "{not-json" を入れる envelope を組み立てる
    const plaintext = new TextEncoder().encode("{not-json");
    const envelope = JSON.stringify({
      v: 1,
      iv: bytesToBase64(new Uint8Array(12)),
      ct: bytesToBase64(plaintext),
    });
    storage.backing.set("k1s0.auth.tokens", envelope);
    // onCorrupt スパイ
    const onCorrupt = vi.fn();
    const store = createEncryptedWebTokenStore({ provider, storage, onCorrupt });
    // JSON.parse 失敗 → undefined
    expect(await store.get()).toBeUndefined();
    // onCorrupt 呼び出し確認
    expect(onCorrupt).toHaveBeenCalledTimes(1);
    // 第 1 引数が平文文字列であること (envelope ではなく復号後)
    expect(onCorrupt.mock.calls[0]?.[0]).toBe("{not-json");
    // 破損データが削除されていること
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // スキーマ検証失敗 → onCorrupt + cleanup
  it("復号後の JSON がスキーマ違反だと onCorrupt が呼ばれ破損データが削除される", async () => {
    // identity provider
    const provider = createIdentityProvider();
    const storage = createFakeStorage();
    // accessToken が数値の不正ペイロード
    const plaintext = new TextEncoder().encode(JSON.stringify({ accessToken: 123 }));
    const envelope = JSON.stringify({
      v: 1,
      iv: bytesToBase64(new Uint8Array(12)),
      ct: bytesToBase64(plaintext),
    });
    storage.backing.set("k1s0.auth.tokens", envelope);
    const onCorrupt = vi.fn();
    const store = createEncryptedWebTokenStore({ provider, storage, onCorrupt });
    // スキーマ検証失敗 → undefined
    expect(await store.get()).toBeUndefined();
    // onCorrupt 呼び出し確認
    expect(onCorrupt).toHaveBeenCalledTimes(1);
    // 破損データが削除されていること
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // onCorrupt 未指定でも例外なく動作すること
  it("onCorrupt を省略しても破損時に例外を投げない", async () => {
    const provider = createIdentityProvider();
    const storage = createFakeStorage();
    // 不正 envelope を仕込む
    const plaintext = new TextEncoder().encode("{not-json");
    const envelope = JSON.stringify({
      v: 1,
      iv: bytesToBase64(new Uint8Array(12)),
      ct: bytesToBase64(plaintext),
    });
    storage.backing.set("k1s0.auth.tokens", envelope);
    // onCorrupt 未指定
    const store = createEncryptedWebTokenStore({ provider, storage });
    // 取得は undefined (例外伝播せず)
    expect(await store.get()).toBeUndefined();
    // 破損データが削除されていること
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // 未保存キーへの get は undefined (復号も走らない)
  it("未保存キーへの get は undefined を返す", async () => {
    const provider = createIdentityProvider();
    const storage = createFakeStorage();
    const store = createEncryptedWebTokenStore({ provider, storage });
    // 未保存 → undefined
    expect(await store.get()).toBeUndefined();
  });

  // remove 失敗を握りつぶす経路: removeItem が throw する storage で破損データを取得しても落ちないこと
  it("破損データ削除中の storage.removeItem 例外を握りつぶす", async () => {
    const provider = createIdentityProvider();
    // 通常の fake storage を作り、removeItem だけ throw に差し替える
    const storage = createFakeStorage();
    // 不正 envelope を仕込む
    const plaintext = new TextEncoder().encode("{not-json");
    const envelope = JSON.stringify({
      v: 1,
      iv: bytesToBase64(new Uint8Array(12)),
      ct: bytesToBase64(plaintext),
    });
    storage.backing.set("k1s0.auth.tokens", envelope);
    // removeItem を throw に差し替える
    storage.removeItem = (): void => {
      throw new Error("denied");
    };
    const onCorrupt = vi.fn();
    const store = createEncryptedWebTokenStore({ provider, storage, onCorrupt });
    // get は throw せず undefined
    expect(await store.get()).toBeUndefined();
    // onCorrupt は呼ばれる
    expect(onCorrupt).toHaveBeenCalledTimes(1);
  });
});
