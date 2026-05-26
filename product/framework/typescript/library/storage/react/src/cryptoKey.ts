// IndexedDB 経由で CryptoKey を保存・取出すためのバックエンドを再利用
import { createIndexedDbBackend } from "./indexedDB.js";

// 既定の DB 名 (アプリ全体の暗号鍵を 1 箇所に集約する用途想定)
const DEFAULT_DB_NAME = "k1s0-storage-keys";
// 既定のオブジェクトストア名
const DEFAULT_STORE_NAME = "crypto-keys";

// 単発で AES-GCM 256bit の non-extractable 鍵を生成する
// extractable:false により JavaScript からは raw bytes を読み出せず、
// 暗号化操作は subtle 経由でしか行えなくなる (鍵漏洩を構造的に防ぐ)
export async function createAesKey(): Promise<CryptoKey> {
  // Web Crypto に AES-GCM 256bit 鍵生成を依頼
  return await crypto.subtle.generateKey(
    // アルゴリズム指定 (AES-GCM 256bit)
    { name: "AES-GCM", length: 256 },
    // extractable:false で raw bytes 抽出を禁止する
    false,
    // 暗号化と復号にのみ使う
    ["encrypt", "decrypt"],
  );
}

// loadOrCreateAesKey のオプション
export interface LoadOrCreateAesKeyOptions {
  // 鍵に紐付けるキー名 (異なるアプリ用途で複数鍵を持つ場合に使う)
  keyName: string;
  // IndexedDB のデータベース名 (既定 "k1s0-storage-keys")
  dbName?: string;
  // オブジェクトストア名 (既定 "crypto-keys")
  storeName?: string;
  // IndexedDB ファクトリ (省略時 globalThis.indexedDB、テスト容易化)
  factory?: IDBFactory;
}

// 鍵生成中のシングルフライト Promise を保持する (合成キー単位)
// 並行起動で「双方が undefined を観測 → 双方が新規生成 → 後勝ち」を防ぎ、
// 旧鍵で暗号化されたデータが復号不能になる事故を構造的に回避する
const inflightKeys: Map<string, Promise<CryptoKey>> = new Map();

// IndexedDB から CryptoKey を読み出し、未保存なら新規生成して保存する
// CryptoKey は構造化クローンで IndexedDB に保存され、extractable:false が維持される
// (raw bytes はディスクにも JS にも露出しない: ブラウザが内部表現を保持する)
export async function loadOrCreateAesKey(
  // オプション
  options: LoadOrCreateAesKeyOptions,
): Promise<CryptoKey> {
  // 並行性は「同一論理鍵」単位で制御する (dbName / storeName / keyName の 3 つ組)
  // 別 DB・別ストアの鍵は独立に生成できるよう、合成キーを inflight Map の lookup key にする
  const cacheKey = `${options.dbName ?? DEFAULT_DB_NAME}::${options.storeName ?? DEFAULT_STORE_NAME}::${options.keyName}`;
  // 既に in-flight な生成 Promise があれば、それを共有して同じ CryptoKey 参照を返す
  const existingTask = inflightKeys.get(cacheKey);
  // ヒットしたら新たに生成・保存を走らせずに await するだけ
  if (existingTask !== undefined) return existingTask;
  // 新規 in-flight Promise を組み立てる (executor は同期実行されるため Map 登録より前に確実に生成される)
  const task: Promise<CryptoKey> = (async (): Promise<CryptoKey> => {
    // CryptoKey を格納する KvStore を組み立てる
    const store = createIndexedDbBackend<CryptoKey>({
      // データベース名 (既定値を採用)
      dbName: options.dbName ?? DEFAULT_DB_NAME,
      // ストア名 (既定値を採用)
      storeName: options.storeName ?? DEFAULT_STORE_NAME,
      // テスト用 factory 注入 (本番は globalThis.indexedDB が使われる)
      factory: options.factory,
    });
    // 既存鍵を取り出す試行
    const existing = await store.get(options.keyName);
    // 既存鍵があればそのまま返す (再ログイン不要)
    if (existing !== undefined) return existing;
    // 不在なら新規生成
    const fresh = await createAesKey();
    // IndexedDB に保存 (構造化クローンで CryptoKey そのものを保存)
    await store.set(options.keyName, fresh);
    // 生成した鍵を返す
    return fresh;
  })();
  // 並行する後続呼び出しが同じ Promise を共有できるよう Map に登録する
  inflightKeys.set(cacheKey, task);
  // 成否いずれの経路でも Map から確実に削除する (rejected Promise を残すと以降全呼び出しが腐るため)
  try {
    // in-flight Promise を待って結果を返す
    return await task;
  } finally {
    // 自分のインスタンスが末尾のままなら削除する (防御的な同一性比較)
    if (inflightKeys.get(cacheKey) === task) {
      // Map から自分の Promise を取り除く
      inflightKeys.delete(cacheKey);
    }
  }
}
