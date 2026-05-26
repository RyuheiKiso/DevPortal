// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象を取り込み
import {
  // 汎用 backend を受ける低レベル API
  createNativeTokenStore,
  // Keychain 推奨パス
  createKeychainTokenStore,
  // SecureStore 推奨パス
  createSecureStoreTokenStore,
} from "./storage.js";
// 公開型を取り込み
import type { NativeKeyValueStorage } from "./storage.js";
// Keychain / SecureStore モジュール duck 型を取り込み (モック構築用)
import type { KeychainModule, SecureNativeStorage } from "@k1s0-ts-storage/react-native";

// 同期 storage 実装のヘルパ（同期 string|null を返す）
function createSyncStorage(): NativeKeyValueStorage & { backing: Map<string, string> } {
  // バッキング Map
  const backing = new Map<string, string>();
  // NativeKeyValueStorage 契約を満たす実装を返す
  return {
    // バッキングを公開（アサーション用）
    backing,
    // 同期 getItem
    getItem(key: string): string | null {
      // Map から取得
      const value = backing.get(key);
      // undefined を null に変換
      return value === undefined ? null : value;
    },
    // 同期 setItem
    setItem(key: string, value: string): void {
      // Map に保存
      backing.set(key, value);
    },
    // 同期 removeItem
    removeItem(key: string): void {
      // Map から削除
      backing.delete(key);
    },
  };
}

// 非同期 storage 実装のヘルパ（Promise を返す）
function createAsyncStorage(): NativeKeyValueStorage & { backing: Map<string, string> } {
  // バッキング Map
  const backing = new Map<string, string>();
  // 非同期版を返す
  return {
    // 公開バッキング
    backing,
    // Promise を返す getItem
    async getItem(key: string): Promise<string | null> {
      // Map から取得
      const value = backing.get(key);
      // undefined を null に変換
      return value === undefined ? null : value;
    },
    // Promise を返す setItem
    async setItem(key: string, value: string): Promise<void> {
      // Map に保存
      backing.set(key, value);
    },
    // Promise を返す removeItem
    async removeItem(key: string): Promise<void> {
      // Map から削除
      backing.delete(key);
    },
  };
}

// createNativeTokenStore のテスト
describe("createNativeTokenStore", () => {
  // 同期 storage に対して get / set / clear ができること
  it("同期 storage に対して JSON シリアライズで保存・取得・削除する", async () => {
    // 同期 storage
    const storage = createSyncStorage();
    // 既定キーで store を作る
    const store = createNativeTokenStore(storage);
    // 未保存時は undefined
    expect(await store.get()).toBeUndefined();
    // 保存する
    await store.set({ accessToken: "a", refreshToken: "r" });
    // バッキングに JSON で書かれていること
    expect(storage.backing.get("k1s0.auth.tokens")).toBe(JSON.stringify({ accessToken: "a", refreshToken: "r" }));
    // 取得できること
    expect(await store.get()).toEqual({ accessToken: "a", refreshToken: "r" });
    // 削除する
    await store.clear();
    // バッキングから消えていること
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // 非同期 storage に対しても同様に動作すること
  it("非同期 storage（Promise を返す）でも動作する", async () => {
    // 非同期 storage
    const storage = createAsyncStorage();
    // カスタムキーで store を作る
    const store = createNativeTokenStore(storage, "custom-key");
    // 未保存時は undefined
    expect(await store.get()).toBeUndefined();
    // 保存する
    await store.set({ accessToken: "z" });
    // カスタムキーで保存されていること
    expect(storage.backing.get("custom-key")).toBe(JSON.stringify({ accessToken: "z" }));
    // 取得できること
    expect(await store.get()).toEqual({ accessToken: "z" });
    // 削除する
    await store.clear();
    // 消えていること
    expect(storage.backing.has("custom-key")).toBe(false);
  });

  // setItem / removeItem が呼ばれていることを spy で確認
  it("set / clear で storage の setItem / removeItem を呼ぶ", async () => {
    // 同期 storage
    const storage = createSyncStorage();
    // setItem を spy
    const setSpy = vi.spyOn(storage, "setItem");
    // removeItem を spy
    const removeSpy = vi.spyOn(storage, "removeItem");
    // store を作る
    const store = createNativeTokenStore(storage);
    // set する
    await store.set({ accessToken: "a" });
    // setItem が呼ばれていること
    expect(setSpy).toHaveBeenCalledTimes(1);
    // clear する
    await store.clear();
    // removeItem が呼ばれていること
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});

// react-native-keychain モック (perKey モード前提: service 名でバッキングを管理)
function createMockKeychain(): KeychainModule & { backing: Map<string, string> } {
  // service ごとの password を保持するバッキング Map
  const backing = new Map<string, string>();
  // KeychainModule 契約を満たすモックを返す
  return {
    // バッキングを公開 (アサーション用)
    backing,
    // generic password 保存 (service 名をキーに password を保存する)
    async setGenericPassword(_username, password, options) {
      // service が無ければエラー扱い (perKey モードでは必ず service が渡る)
      const service = options?.service ?? "";
      // バッキングに保存
      backing.set(service, password);
      // 成功は boolean で返すのが Keychain 仕様
      return true;
    },
    // generic password 取得 (未保存は false)
    async getGenericPassword(options) {
      // service 名を取り出す
      const service = options?.service ?? "";
      // バッキング参照
      const password = backing.get(service);
      // 未保存は false
      if (password === undefined) return false;
      // 値が見つかった場合は { username, password, service }
      return { username: service, password, service };
    },
    // generic password 削除 (service ごと消す)
    async resetGenericPassword(options) {
      // service 名を取り出す
      const service = options?.service ?? "";
      // バッキングから削除
      backing.delete(service);
      // 成功は boolean
      return true;
    },
  };
}

// expo-secure-store モック (シンプルな in-memory KVS)
function createMockSecureStore(): SecureNativeStorage & { backing: Map<string, string> } {
  // バッキング Map
  const backing = new Map<string, string>();
  // SecureNativeStorage 契約を満たすモックを返す
  return {
    // バッキングを公開
    backing,
    // 値取得 (未保存は null)
    async getItemAsync(key) {
      // バッキング参照
      const value = backing.get(key);
      // undefined は null に正規化
      return value === undefined ? null : value;
    },
    // 値保存
    async setItemAsync(key, value) {
      // バッキングに保存
      backing.set(key, value);
    },
    // 値削除
    async deleteItemAsync(key) {
      // バッキングから削除
      backing.delete(key);
    },
  };
}

// createKeychainTokenStore のテスト
describe("createKeychainTokenStore", () => {
  // Keychain backend で get / set / clear が JSON シリアライズ経由で機能すること
  it("Keychain backend に JSON シリアライズで保存・取得・削除する", async () => {
    // Keychain モック
    const keychain = createMockKeychain();
    // 既定キーで store を作る (perKey モードでは service = "k1s0-storage/k1s0.auth.tokens")
    const store = createKeychainTokenStore(keychain);
    // 未保存時は undefined
    expect(await store.get()).toBeUndefined();
    // 保存する
    await store.set({ accessToken: "a", refreshToken: "r" });
    // Keychain 上のバッキング (service 名 = "k1s0-storage/k1s0.auth.tokens") に JSON で書かれていること
    expect(keychain.backing.get("k1s0-storage/k1s0.auth.tokens")).toBe(
      JSON.stringify({ accessToken: "a", refreshToken: "r" }),
    );
    // 取得できること
    expect(await store.get()).toEqual({ accessToken: "a", refreshToken: "r" });
    // 削除する
    await store.clear();
    // バッキングから消えていること
    expect(keychain.backing.has("k1s0-storage/k1s0.auth.tokens")).toBe(false);
  });

  // カスタムキーと backend オプションが反映されること
  it("カスタムキーと servicePrefix が反映される", async () => {
    // Keychain モック
    const keychain = createMockKeychain();
    // カスタム servicePrefix + カスタムキー
    const store = createKeychainTokenStore(keychain, {
      // カスタムキー
      key: "myapp.tokens",
      // backend 設定
      backend: { servicePrefix: "myapp" },
    });
    // 保存
    await store.set({ accessToken: "z" });
    // service 名は "myapp/myapp.tokens" になる
    expect(keychain.backing.get("myapp/myapp.tokens")).toBe(JSON.stringify({ accessToken: "z" }));
  });
});

// createSecureStoreTokenStore のテスト
describe("createSecureStoreTokenStore", () => {
  // SecureStore backend で get / set / clear が JSON シリアライズ経由で機能すること
  it("SecureStore backend に JSON シリアライズで保存・取得・削除する", async () => {
    // SecureStore モック
    const secureStore = createMockSecureStore();
    // 既定キーで store を作る
    const store = createSecureStoreTokenStore(secureStore);
    // 未保存時は undefined
    expect(await store.get()).toBeUndefined();
    // 保存する
    await store.set({ accessToken: "a", refreshToken: "r" });
    // SecureStore 上のバッキングに JSON で書かれていること
    expect(secureStore.backing.get("k1s0.auth.tokens")).toBe(
      JSON.stringify({ accessToken: "a", refreshToken: "r" }),
    );
    // 取得できること
    expect(await store.get()).toEqual({ accessToken: "a", refreshToken: "r" });
    // 削除する
    await store.clear();
    // バッキングから消えていること
    expect(secureStore.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // カスタムキーが反映されること
  it("カスタムキーが反映される", async () => {
    // SecureStore モック
    const secureStore = createMockSecureStore();
    // カスタムキーを指定
    const store = createSecureStoreTokenStore(secureStore, { key: "myapp.tokens" });
    // 保存
    await store.set({ accessToken: "z" });
    // 指定したキーに保存されていること
    expect(secureStore.backing.get("myapp.tokens")).toBe(JSON.stringify({ accessToken: "z" }));
  });
});
