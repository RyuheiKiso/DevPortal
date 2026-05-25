// core から KvStore 型と SyncStorage アダプタを取り込み
import { createSyncBacked, type KvStore } from "@k1s0-ts-storage/core";

// createLocalStorageBackend のオプション
export interface CreateLocalStorageBackendOptions {
  // 注入する Storage (省略時は window.localStorage、SSR でも安全に差し替えられる)
  storage?: Storage;
}

// ブラウザの localStorage を統一非同期 KvStore<string> に昇格する
// 値は string のみ扱う (任意の T を扱うなら withCodec を被せる)
export function createLocalStorageBackend(options?: CreateLocalStorageBackendOptions): KvStore<string> {
  // 注入された Storage、または window.localStorage を採用
  const storage = options?.storage ?? window.localStorage;
  // createSyncBacked で非同期化して返す (length / key(i) があるので keys/clear も自動で提供)
  return createSyncBacked(storage);
}
