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

// IndexedDB から CryptoKey を読み出し、未保存なら新規生成して保存する
// CryptoKey は構造化クローンで IndexedDB に保存され、extractable:false が維持される
// (raw bytes はディスクにも JS にも露出しない: ブラウザが内部表現を保持する)
export async function loadOrCreateAesKey(
  // オプション
  options: LoadOrCreateAesKeyOptions,
): Promise<CryptoKey> {
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
}
