// core から KvStore 型と SyncStorage アダプタを取り込み
import { createSyncBacked, type KvStore } from "@k1s0-ts-storage/core";
// ローカル型を取り込み
import type { NativeKeyValueStorage } from "./types.js";

// AsyncStorage 形状の依存を非同期 KvStore<string> に正規化する
// @react-native-async-storage/async-storage や互換実装 (RNFS など) を統一して受ける
// getAllKeys / clear を提供する実装ならそれぞれを使い、無ければ createSyncBacked の保証する範囲だけ提供
export function createAsyncStorageBackend(storage: NativeKeyValueStorage): KvStore<string> {
  // createSyncBacked は length/key 経由でしか keys を構築できないため、AsyncStorage 形では keys を提供しない
  // ここで getAllKeys / clear が利用可能ならラッパで補足する
  const base = createSyncBacked(storage);
  // 補足前の状態を取り出す (createSyncBacked の戻り値は readonly でない)
  const result: KvStore<string> = {
    get: base.get,
    set: base.set,
    remove: base.remove,
  };
  // getAllKeys が提供されている場合のみ keys を実装
  if (typeof storage.getAllKeys === "function") {
    const getAllKeys = storage.getAllKeys.bind(storage);
    result.keys = async (): Promise<readonly string[]> => {
      // 同期 / 非同期どちらも await で正規化
      return Promise.resolve(getAllKeys());
    };
  }
  // clear が提供されている場合のみ clear を実装
  if (typeof storage.clear === "function") {
    const clear = storage.clear.bind(storage);
    result.clear = async (): Promise<void> => {
      // 同期 / 非同期どちらも await で正規化
      await Promise.resolve(clear());
    };
  }
  // 完成した KvStore を返す
  return result;
}
