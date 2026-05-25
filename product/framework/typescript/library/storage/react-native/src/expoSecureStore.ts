// core から KvStore 型を取り込み
import type { KvStore } from "@k1s0-ts-storage/core";
// ローカル型を取り込み
import type { SecureNativeStorage } from "./types.js";

// expo-secure-store 形状の依存を非同期 KvStore<string> に正規化する
// getAllKeys / clear が無いため、keys/clear は提供しない (registry の clearScope は exceptKeys 無で全削除のみ可能、
// それも store.clear が無いと NotAvailable になる点に注意)
export function createExpoSecureStoreBackend(secureStore: SecureNativeStorage): KvStore<string> {
  // 完成した KvStore を返す
  return {
    // 取得: null は undefined に正規化する
    async get(key: string): Promise<string | undefined> {
      // getItemAsync は string | null を返す
      const raw = await secureStore.getItemAsync(key);
      // null は KvStore 契約に合わせて undefined
      if (raw === null) return undefined;
      // 文字列はそのまま
      return raw;
    },
    // 保存
    async set(key: string, value: string): Promise<void> {
      // setItemAsync に委譲
      await secureStore.setItemAsync(key, value);
    },
    // 削除
    async remove(key: string): Promise<void> {
      // deleteItemAsync に委譲
      await secureStore.deleteItemAsync(key);
    },
  };
}
