// 公開型を取り込み
import type { KvStore } from "@k1s0-ts-storage/core";

// createIndexedDbBackend のオプション
export interface CreateIndexedDbBackendOptions {
  // データベース名
  dbName: string;
  // オブジェクトストア名
  storeName: string;
  // スキーマバージョン (省略時 1)
  version?: number;
  // 注入する indexedDB ファクトリ (テスト容易化、SSR 互換のため、省略時 globalThis.indexedDB)
  factory?: IDBFactory;
}

// IDBRequest を Promise に変換するヘルパ
function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  // 完成した Promise を返す
  return new Promise<T>((resolve, reject) => {
    // 成功時に値を返す
    request.addEventListener("success", () => resolve(request.result));
    // 失敗時にエラーで reject
    request.addEventListener("error", () => reject(request.error));
  });
}

// 自前の最小 IndexedDB 抽象を提供する KvStore を生成する
// 単一 object store / 単一 DB の単純構成 (idb-keyval ライク)
export function createIndexedDbBackend<T = unknown>(
  options: CreateIndexedDbBackendOptions,
): KvStore<T> {
  // 設定の取り出し
  const dbName = options.dbName;
  const storeName = options.storeName;
  const version = options.version ?? 1;
  const factory = options.factory ?? globalThis.indexedDB;
  // open は遅延 (1 回成功したら以降は使い回す)
  let dbPromise: Promise<IDBDatabase> | null = null;
  // データベース接続を取得 (初回のみ open)
  const getDb = (): Promise<IDBDatabase> => {
    // 既に Promise があればそれを返す
    if (dbPromise !== null) return dbPromise;
    // open リクエストを作る
    const request = factory.open(dbName, version);
    // upgrade ハンドラ (新規 / バージョン上昇時に store を作成)
    request.addEventListener("upgradeneeded", () => {
      // db インスタンス
      const db = request.result;
      // ストアが無ければ作成
      if (!db.objectStoreNames.contains(storeName)) {
        // 単純な keyPath なしストアを作成
        db.createObjectStore(storeName);
      }
    });
    // Promise を組み立てて保存
    dbPromise = promisifyRequest(request);
    // 同じ Promise を返す
    return dbPromise;
  };
  // 単純な transaction ヘルパ
  const withStore = async <R>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R> => {
    // DB を取得
    const db = await getDb();
    // トランザクション作成
    const tx = db.transaction(storeName, mode);
    // 対象 store
    const store = tx.objectStore(storeName);
    // 実際の操作リクエストを起動
    const request = operation(store);
    // 完了待ち
    return promisifyRequest(request);
  };
  // 完成した KvStore を返す
  return {
    // 取得
    async get(key: string): Promise<T | undefined> {
      // store.get の戻り値は undefined または保存値
      const result = await withStore<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
      // そのまま返す
      return result;
    },
    // 保存
    async set(key: string, value: T): Promise<void> {
      // put で上書き保存
      await withStore("readwrite", (s) => s.put(value, key));
    },
    // 削除
    async remove(key: string): Promise<void> {
      // delete で削除
      await withStore("readwrite", (s) => s.delete(key));
    },
    // 存在判定
    async has(key: string): Promise<boolean> {
      // count で 1 件以上あるか判定
      const count = await withStore<number>("readonly", (s) => s.count(key));
      // 1 以上なら存在
      return count > 0;
    },
    // キー列挙
    // 本ラッパーは set/remove/has で常に string キーのみ扱うため getAllKeys の戻りも string[]
    async keys(): Promise<readonly string[]> {
      // getAllKeys は IDBValidKey[] を返す (string のみ格納している前提で as キャスト)
      const all = await withStore<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
      // string 配列として返す
      return all as readonly string[];
    },
    // 全削除
    async clear(): Promise<void> {
      // store.clear で一括削除
      await withStore("readwrite", (s) => s.clear());
    },
  };
}
