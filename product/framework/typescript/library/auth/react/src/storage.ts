// core から型を取り込み
import type { AuthTokenSet, TokenStore } from "@k1s0-ts-auth/core";
// メモリ TokenStore を取り込み（SSR / 利用不能環境のフォールバックに使う）
import { createMemoryTokenStore } from "@k1s0-ts-auth/core";

// Web の Storage 系 API（localStorage / sessionStorage）と互換な最小契約
export interface WebKeyValueStorage {
  // 指定キーの文字列値を取得する
  getItem(key: string): string | null;
  // 指定キーへ文字列値を保存する
  setItem(key: string, value: string): void;
  // 指定キーの値を削除する
  removeItem(key: string): void;
}

// createWebTokenStore に渡せるオプション
export interface WebTokenStoreOptions {
  // 保存先 Storage（既定値: window.localStorage、利用不能時はメモリ）
  storage?: WebKeyValueStorage;
  // 保存キー（既定値: "k1s0.auth.tokens"）
  key?: string;
}

// 既定で利用する保存キー
const DEFAULT_KEY = "k1s0.auth.tokens";

// 既定の Storage を解決する（SSR や非ブラウザ環境では undefined を返す）
function resolveDefaultStorage(): WebKeyValueStorage | undefined {
  // window が存在しない環境（SSR / Node）ではフォールバックさせる
  if (typeof window === "undefined") return undefined;
  // localStorage が利用不能な環境（プライベートブラウジング厳格モードなど）に備える
  try {
    // 参照だけでも throw する実装があるため try で囲む
    const storage = window.localStorage;
    // 存在しなければ undefined を返す
    if (storage === undefined || storage === null) return undefined;
    // 取得した Storage を返す
    return storage;
  } catch {
    // 参照例外時はフォールバックする
    return undefined;
  }
}

// 受け取った文字列を AuthTokenSet として復元する（壊れていれば undefined）
function parseTokens(raw: string): AuthTokenSet | undefined {
  // 不正な JSON や非オブジェクトを安全に弾く
  try {
    // 復元を試みる
    const parsed = JSON.parse(raw) as unknown;
    // null / 非オブジェクトなら破損扱い
    if (parsed === null || typeof parsed !== "object") return undefined;
    // AuthTokenSet として返す（型は呼び出し側責任）
    return parsed as AuthTokenSet;
  } catch {
    // パース不能なら破損扱い
    return undefined;
  }
}

// Web 環境向け TokenStore を作る
export function createWebTokenStore(options: WebTokenStoreOptions = {}): TokenStore {
  // 保存キーを既定値とマージ
  const key = options.key ?? DEFAULT_KEY;
  // Storage を解決する（明示指定が優先、未指定なら window.localStorage）
  const storage = options.storage ?? resolveDefaultStorage();
  // Storage が利用不能ならメモリ実装にフォールバックする（SSR 安全）
  if (storage === undefined) {
    // メモリ TokenStore を返す
    return createMemoryTokenStore();
  }
  // TokenStore 契約を返す
  return {
    // 保存済みトークンを取得する
    async get(): Promise<AuthTokenSet | undefined> {
      // 同期 Storage から値を取り出す
      const raw = storage.getItem(key);
      // 未保存なら undefined
      if (raw === null) return undefined;
      // 復元できなかった場合は破損データを掃除して undefined を返す
      const parsed = parseTokens(raw);
      // 破損していれば掃除する
      if (parsed === undefined) {
        // 破損データを削除して整合性を保つ
        storage.removeItem(key);
        // 取得結果として undefined を返す
        return undefined;
      }
      // 正常復元できた値を返す
      return parsed;
    },
    // トークンを保存する
    async set(tokens: AuthTokenSet): Promise<void> {
      // JSON 文字列として保存する
      storage.setItem(key, JSON.stringify(tokens));
    },
    // トークンを削除する
    async clear(): Promise<void> {
      // storage から削除する
      storage.removeItem(key);
    },
  };
}
