// core から型を取り込み
import type { AuthTokenSet, TokenStore } from "@k1s0-ts-auth/core";

// React Native の各種 storage 実装に合わせる最小契約
export interface NativeKeyValueStorage {
  // 指定キーの文字列値を取得する
  getItem(key: string): string | null | Promise<string | null>;
  // 指定キーへ文字列値を保存する
  setItem(key: string, value: string): void | Promise<void>;
  // 指定キーの値を削除する
  removeItem(key: string): void | Promise<void>;
}

// React Native 向け TokenStore を作る
export function createNativeTokenStore(
  // SecureStore / AsyncStorage / Keychain wrapper など
  storage: NativeKeyValueStorage,
  // 保存キー
  key = "k1s0.auth.tokens",
): TokenStore {
  // TokenStore 契約を返す
  return {
    // 保存済みトークンを取得する
    async get(): Promise<AuthTokenSet | undefined> {
      // storage から文字列を取得する
      const raw = await storage.getItem(key);
      // 未保存なら undefined
      if (raw === null) return undefined;
      // JSON を AuthTokenSet として復元する
      return JSON.parse(raw) as AuthTokenSet;
    },
    // トークンを保存する
    async set(tokens: AuthTokenSet): Promise<void> {
      // JSON 文字列として保存する
      await storage.setItem(key, JSON.stringify(tokens));
    },
    // トークンを削除する
    async clear(): Promise<void> {
      // storage から削除する
      await storage.removeItem(key);
    },
  };
}
