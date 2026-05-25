// core から型と zod スキーマを取り込み
import type { AuthTokenSet, TokenStore } from "@k1s0-ts-auth/core";
// メモリ TokenStore (フォールバック用) と AuthTokenSet 検証スキーマ
import { authTokenSetSchema, createMemoryTokenStore } from "@k1s0-ts-auth/core";
// storage/core から暗号化ラッパと CryptoProvider 型
import type { CryptoProvider, KvStore } from "@k1s0-ts-storage/core";
// 暗号化合成用 API
import { withEncryption } from "@k1s0-ts-storage/core";
// localStorage バックエンド (storage/react)
import { createLocalStorageBackend } from "@k1s0-ts-storage/react";
// 既存の Web 平文 TokenStore と型を共有 (WebKeyValueStorage / DEFAULT_KEY / corrupt handler)
import type { WebKeyValueStorage, WebTokenStoreCorruptHandler } from "./storage.js";

// createEncryptedWebTokenStore に渡せるオプション
export interface EncryptedWebTokenStoreOptions {
  // 必須: 呼び出し側で生成済みの CryptoProvider (鍵管理は外部責任)
  // 推奨: storage/core の createAesGcmProvider({ key }) に importKey 済みの CryptoKey を渡す
  // 鍵は IndexedDB に non-extractable CryptoKey として保存することを推奨
  provider: CryptoProvider;
  // 保存先 Storage (既定: window.localStorage、利用不能時はメモリにフォールバック)
  storage?: WebKeyValueStorage;
  // 保存キー (既定: "k1s0.auth.tokens")
  key?: string;
  // 破損データ検出時の observability コールバック (optional)
  // 復号失敗 / JSON.parse 失敗 / スキーマ検証失敗のいずれでも呼ばれる
  onCorrupt?: WebTokenStoreCorruptHandler;
}

// 既定で利用する保存キー (storage.ts と統一)
const DEFAULT_KEY = "k1s0.auth.tokens";

// 既定の Storage を解決する (SSR や非ブラウザ環境では undefined を返す)
function resolveDefaultStorage(): WebKeyValueStorage | undefined {
  // window が存在しない環境 (SSR / Node) ではフォールバックさせる
  if (typeof window === "undefined") return undefined;
  // localStorage 参照だけで throw する実装 (厳格モード等) に備える
  try {
    // 参照を試みる
    const storage = window.localStorage;
    // 存在しなければ undefined
    if (storage === undefined || storage === null) return undefined;
    // 取得した Storage を返す
    return storage;
  } catch {
    // 参照例外時はフォールバックする
    return undefined;
  }
}

// 暗号化 Web TokenStore を作る
// 内部構成: localStorage → withEncryption (AES-GCM, AAD=key) → JSON+schema validation → TokenStore
// 既存の createWebTokenStore は後方互換のため別途残してある (平文保存)
export function createEncryptedWebTokenStore(options: EncryptedWebTokenStoreOptions): TokenStore {
  // 保存キー
  const key = options.key ?? DEFAULT_KEY;
  // Storage を解決する (明示指定 > 既定の window.localStorage)
  const storage = options.storage ?? resolveDefaultStorage();
  // observability コールバック
  const onCorrupt = options.onCorrupt;
  // Storage が利用不能ならメモリ TokenStore にフォールバック (SSR 安全)
  if (storage === undefined) {
    // メモリ実装を返す (provider は未使用、平文だが in-memory のみ)
    return createMemoryTokenStore();
  }
  // KvStore<string> として localStorage を昇格する
  // createLocalStorageBackend は Storage 型を要求するため、最小契約を満たすキャストで渡す
  // (実体は同じ getItem/setItem/removeItem インターフェース)
  const backend: KvStore<string> = createLocalStorageBackend({ storage: storage as Storage });
  // 暗号化レイヤを被せる (内側 string、外側も string で encrypt/decrypt のみ担当)
  // aadFromKey=true でキー名を AAD に使うため、別キーで読み替えても改ざん検知できる
  const encrypted: KvStore<string> = withEncryption<string>({
    // 注入された CryptoProvider
    provider: options.provider,
    // キー名を AAD に使う (改ざん検知強化)
    aadFromKey: true,
  })(backend);
  // 破損データを掃除するヘルパ (remove 失敗は無視: 一時 IO エラー耐性のため)
  const removeQuietly = async (): Promise<void> => {
    // 削除を試みる
    try {
      // 暗号化レイヤ経由で remove (内部の localStorage.removeItem に到達)
      await encrypted.remove(key);
    } catch {
      // 削除失敗は致命的でないため握りつぶす (次回 get 時に再度試みられる)
    }
  };
  // TokenStore 契約を返す
  return {
    // 保存済みトークンを取得する
    async get(): Promise<AuthTokenSet | undefined> {
      // 復号後の平文 JSON 文字列
      let plaintext: string | undefined;
      // 復号 (鍵不一致 / 改ざん / envelope 不正で throw する可能性あり)
      try {
        // encrypted.get は復号も含む (失敗時は throw)
        plaintext = await encrypted.get(key);
      } catch (error) {
        // 復号失敗 / envelope 不正は破損扱い
        onCorrupt?.("", error);
        // 破損データを掃除して undefined を返す (自動再ログイン経路)
        await removeQuietly();
        // 取得結果として undefined を返す
        return undefined;
      }
      // 未保存なら undefined
      if (plaintext === undefined) return undefined;
      // 平文 JSON をパース
      let parsed: unknown;
      try {
        // 復号成功後の平文を JSON として解釈する
        parsed = JSON.parse(plaintext);
      } catch (error) {
        // 平文が JSON でない場合は破損扱い
        onCorrupt?.(plaintext, error);
        // 破損データを掃除
        await removeQuietly();
        // undefined を返す
        return undefined;
      }
      // zod スキーマで実行時検証 (型不一致 / 余剰フィールド拒否)
      const result = authTokenSetSchema.safeParse(parsed);
      // 検証失敗は破損扱い
      if (!result.success) {
        // observability コールバック
        onCorrupt?.(plaintext, result.error);
        // 破損データを掃除
        await removeQuietly();
        // undefined を返す
        return undefined;
      }
      // 検証済みデータを返す
      return result.data;
    },
    // トークンを保存する (暗号化 + envelope 書き込み)
    async set(tokens: AuthTokenSet): Promise<void> {
      // JSON 文字列化してから暗号化レイヤに渡す (encrypted.set 内で encrypt + envelope 化される)
      await encrypted.set(key, JSON.stringify(tokens));
    },
    // トークンを削除する (envelope 削除)
    async clear(): Promise<void> {
      // 暗号化レイヤ経由で remove (内部の localStorage.removeItem に到達)
      await encrypted.remove(key);
    },
  };
}
