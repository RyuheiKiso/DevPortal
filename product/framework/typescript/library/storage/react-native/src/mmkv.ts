// core から KvStore 型を取り込み
import type { KvStore } from "@k1s0-ts-storage/core";
// ローカル型を取り込み
import type { MmkvInstance } from "./types.js";

// react-native-mmkv の同期 API を非同期 KvStore<string> に統一する
// MMKV は同期 API のため、Promise.resolve で都度ラップする (await コストは無視できるレベル)
export function createMmkvBackend(mmkv: MmkvInstance): KvStore<string> {
  // 完成した KvStore を返す
  return {
    // 取得: undefined をそのまま返す (null は無い)
    async get(key: string): Promise<string | undefined> {
      // MMKV は未保存で undefined を返す
      return mmkv.getString(key);
    },
    // 保存
    async set(key: string, value: string): Promise<void> {
      // set は同期
      mmkv.set(key, value);
    },
    // 削除
    async remove(key: string): Promise<void> {
      // delete は同期
      mmkv.delete(key);
    },
    // 存在判定: contains が無ければ getString で代替
    async has(key: string): Promise<boolean> {
      // contains 関数があれば使う
      if (typeof mmkv.contains === "function") return mmkv.contains(key);
      // 無ければ getString で undefined チェック
      return mmkv.getString(key) !== undefined;
    },
    // キー一覧
    async keys(): Promise<readonly string[]> {
      // getAllKeys は同期
      return mmkv.getAllKeys();
    },
    // 全削除
    async clear(): Promise<void> {
      // clearAll は同期
      mmkv.clearAll();
    },
  };
}
