// storage パッケージから合成可能な部品を取り込み
import { createTypedSlot, jsonCodec, withCodec } from "@k1s0-ts-storage/core";
// KvStore 契約を取り込み (内部ヘルパで KvStore<string> を扱うため)
import type { KvStore } from "@k1s0-ts-storage/core";
// AsyncStorage 互換アダプタと Keychain / SecureStore 用 backend を取り込み
import {
  // AsyncStorage 互換 (getItem / setItem / removeItem) を KvStore<string> に正規化
  createAsyncStorageBackend,
  // expo-secure-store を KvStore<string> に正規化
  createExpoSecureStoreBackend,
  // react-native-keychain を KvStore<string> に正規化
  createKeychainBackend,
} from "@k1s0-ts-storage/react-native";
// duck 型の取り込み (storage パッケージの型を再利用する)
import type {
  // react-native-keychain モジュール duck 型
  KeychainModule,
  // AsyncStorage 互換 duck 型 (後方互換のため再 export)
  NativeKeyValueStorage as StorageNativeKeyValueStorage,
  // expo-secure-store モジュール duck 型
  SecureNativeStorage,
} from "@k1s0-ts-storage/react-native";
// auth core の型を取り込み
import type { AuthTokenSet, TokenStore } from "@k1s0-ts-auth/core";

// 後方互換のための NativeKeyValueStorage 型 (storage パッケージの同名型と構造的に互換)
export type NativeKeyValueStorage = StorageNativeKeyValueStorage;

// 既定で利用する保存キー (3 ヘルパで共通化)
const DEFAULT_KEY = "k1s0.auth.tokens";

// KvStore<string> backend を AuthTokenSet 用 TokenStore に昇格する内部ヘルパ
// (JSON codec を被せて KvStore<AuthTokenSet> 化し、単一キーの TypedSlot を返す)
function buildTokenStoreFromKv(backend: KvStore<string>, key: string): TokenStore {
  // JSON codec で AuthTokenSet を文字列にエンコード
  const codec = jsonCodec<AuthTokenSet>();
  // codec を被せて KvStore<AuthTokenSet> へ昇格
  const decorated = withCodec<string, AuthTokenSet>(codec)(backend);
  // 指定キーを TypedSlot として公開 (= TokenStore alias)
  return createTypedSlot(decorated, key);
}

// React Native 向け TokenStore を作る (汎用 backend を受け取る低レベル API)
// AsyncStorage は平文保存となるため、トークン用途では推奨しない (Keychain / SecureStore を使うこと)
// 内部実装は @k1s0-ts-storage の合成 (AsyncStorage adapter → JSON codec → TypedSlot)
// JSON シリアライズの振る舞い・既定キーは旧実装と完全互換
export function createNativeTokenStore(
  // SecureStore / AsyncStorage / Keychain wrapper など (NativeKeyValueStorage 形を実装するもの)
  storage: NativeKeyValueStorage,
  // 保存キー (既定: 旧実装と同じ "k1s0.auth.tokens")
  key = DEFAULT_KEY,
): TokenStore {
  // storage を統一非同期 KvStore<string> に正規化
  const backend = createAsyncStorageBackend(storage);
  // 共通ヘルパで TokenStore を組み立てて返す
  return buildTokenStoreFromKv(backend, key);
}

// createKeychainTokenStore のオプション
export interface CreateKeychainTokenStoreOptions {
  // 保存キー (既定 "k1s0.auth.tokens")
  key?: string;
  // Keychain backend のモード設定 (servicePrefix / mode / singleService)
  // 省略時は perKey モード + servicePrefix "k1s0-storage" が適用される
  backend?: Parameters<typeof createKeychainBackend>[1];
}

// react-native-keychain で TokenStore を作る (RN 推奨パス)
// 端末の SecureEnclave / Keystore でトークンを保護する
// 利用例: createKeychainTokenStore(Keychain, { key: "myapp.auth.tokens" })
export function createKeychainTokenStore(
  // react-native-keychain モジュール (アプリ側で import * as Keychain from "react-native-keychain")
  keychain: KeychainModule,
  // 追加オプション
  options?: CreateKeychainTokenStoreOptions,
): TokenStore {
  // 既定キーを採用
  const key = options?.key ?? DEFAULT_KEY;
  // Keychain backend を KvStore<string> に正規化
  const backend = createKeychainBackend(keychain, options?.backend);
  // 共通ヘルパで TokenStore を組み立てて返す
  return buildTokenStoreFromKv(backend, key);
}

// createSecureStoreTokenStore のオプション
export interface CreateSecureStoreTokenStoreOptions {
  // 保存キー (既定 "k1s0.auth.tokens")
  key?: string;
}

// expo-secure-store で TokenStore を作る (Expo 環境向け推奨パス)
// 端末の Secure Enclave / Keystore でトークンを保護する
// 利用例: createSecureStoreTokenStore(SecureStore, { key: "myapp.auth.tokens" })
export function createSecureStoreTokenStore(
  // expo-secure-store モジュール (アプリ側で import * as SecureStore from "expo-secure-store")
  secureStore: SecureNativeStorage,
  // 追加オプション
  options?: CreateSecureStoreTokenStoreOptions,
): TokenStore {
  // 既定キーを採用
  const key = options?.key ?? DEFAULT_KEY;
  // SecureStore backend を KvStore<string> に正規化
  const backend = createExpoSecureStoreBackend(secureStore);
  // 共通ヘルパで TokenStore を組み立てて返す
  return buildTokenStoreFromKv(backend, key);
}
