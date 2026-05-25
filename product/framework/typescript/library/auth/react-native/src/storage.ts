// storage パッケージから合成可能な部品を取り込み
import { createTypedSlot, jsonCodec, withCodec } from "@k1s0-ts-storage/core";
// AsyncStorage 互換アダプタと型を取り込み
import { createAsyncStorageBackend } from "@k1s0-ts-storage/react-native";
// 後方互換のため storage パッケージの型を re-export する
import type { NativeKeyValueStorage as StorageNativeKeyValueStorage } from "@k1s0-ts-storage/react-native";
// auth core の型を取り込み
import type { AuthTokenSet, TokenStore } from "@k1s0-ts-auth/core";

// 後方互換のための NativeKeyValueStorage 型 (storage パッケージの同名型と構造的に互換)
export type NativeKeyValueStorage = StorageNativeKeyValueStorage;

// React Native 向け TokenStore を作る
// 内部実装は @k1s0-ts-storage の合成 (AsyncStorage adapter → JSON codec → TypedSlot)
// JSON シリアライズの振る舞い・既定キーは旧実装と完全互換
export function createNativeTokenStore(
  // SecureStore / AsyncStorage / Keychain wrapper など (NativeKeyValueStorage 形を実装するもの)
  storage: NativeKeyValueStorage,
  // 保存キー (既定: 旧実装と同じ "k1s0.auth.tokens")
  key = "k1s0.auth.tokens",
): TokenStore {
  // storage を統一非同期 KvStore<string> に正規化
  const backend = createAsyncStorageBackend(storage);
  // JSON codec で AuthTokenSet を文字列にエンコード
  const codec = jsonCodec<AuthTokenSet>();
  // codec を被せて KvStore<AuthTokenSet> へ昇格
  const decorated = withCodec<string, AuthTokenSet>(codec)(backend);
  // 指定キーを TypedSlot として公開 (= TokenStore alias)
  return createTypedSlot(decorated, key);
}
