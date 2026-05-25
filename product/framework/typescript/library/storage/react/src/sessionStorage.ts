// core から KvStore 型と SyncStorage アダプタを取り込み
import { createSyncBacked, type KvStore } from "@k1s0-ts-storage/core";

// createSessionStorageBackend のオプション
export interface CreateSessionStorageBackendOptions {
  // 注入する Storage (省略時は window.sessionStorage)
  storage?: Storage;
}

// ブラウザの sessionStorage を統一非同期 KvStore<string> に昇格する
// セッション (タブ) 単位の一時保存に使う
export function createSessionStorageBackend(options?: CreateSessionStorageBackendOptions): KvStore<string> {
  // 注入された Storage、または window.sessionStorage を採用
  const storage = options?.storage ?? window.sessionStorage;
  // createSyncBacked で非同期化して返す
  return createSyncBacked(storage);
}
