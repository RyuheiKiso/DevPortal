// storage パッケージからメモリ store と型付きスロットを取り込み
import { createMemoryStore, createTypedSlot } from "@k1s0-ts-storage/core";
// トークン保存先の型を取り込み
import type { AuthTokenSet, TokenStore } from "./types.js";

// 内部で利用する保存キー (TypedSlot に渡す key 名)
const TOKEN_KEY = "tokens";

// メモリ上にトークンを保持する TokenStore を作る
// 内部実装は storage パッケージの createMemoryStore + createTypedSlot に委譲し、
// 外部 mutation 保護のためのコピー処理だけは本ラッパーで維持する (既存 API 契約)
export function createMemoryTokenStore(initial?: AuthTokenSet): TokenStore {
  // 内部 KvStore を生成 (initial があれば key="tokens" にコピーして seed)
  const inner = createMemoryStore<AuthTokenSet>(
    // 初期値があれば外部 mutation を断ち切るためコピーして格納
    initial !== undefined ? { [TOKEN_KEY]: { ...initial } } : undefined,
  );
  // KvStore の "tokens" キーを TypedSlot として公開
  const slot = createTypedSlot(inner, TOKEN_KEY);
  // 外部 mutation を避けるため get/set でコピーを挟む TypedSlot を返す
  return {
    // 現在のトークンをコピーして返す
    async get(): Promise<AuthTokenSet | undefined> {
      // slot から取得した値を取り出す
      const current = await slot.get();
      // 未保存なら undefined
      if (current === undefined) return undefined;
      // 内部状態を共有しないようコピーを返す
      return { ...current };
    },
    // 新しいトークンを保存する
    async set(tokens: AuthTokenSet): Promise<void> {
      // 外部参照の mutation を遮断するためコピーして格納
      await slot.set({ ...tokens });
    },
    // 保存済みトークンを削除する
    async clear(): Promise<void> {
      // slot を空に戻す
      await slot.clear();
    },
  };
}

// トークンが期限切れか判定する
export function isTokenExpired(
  // 判定対象のトークン集合
  tokens: AuthTokenSet | undefined,
  // 現在時刻（テストで固定できるよう注入）
  nowMs = Date.now(),
  // 期限切れとみなす前倒し幅
  skewMs = 0,
): boolean {
  // トークンまたは期限がない場合は期限切れとは扱わない
  if (tokens?.expiresAt === undefined) return false;
  // 現在時刻に前倒し幅を足して期限と比較する
  return nowMs + skewMs >= tokens.expiresAt;
}

// 期限が近いため更新すべきか判定する
export function shouldRefreshToken(
  // 判定対象のトークン集合
  tokens: AuthTokenSet | undefined,
  // 現在時刻（テストで固定できるよう注入）
  nowMs = Date.now(),
  // 更新を始める期限前の猶予幅
  windowMs = 60_000,
): boolean {
  // トークンまたは期限がない場合は更新不要と扱う
  if (tokens?.expiresAt === undefined) return false;
  // 期限までの残り時間が猶予幅以下なら更新対象
  return tokens.expiresAt - nowMs <= windowMs;
}

// Authorization ヘッダ値を組み立てる
export function createAuthorizationHeader(tokens: AuthTokenSet | undefined): string | undefined {
  // accessToken がない場合はヘッダを作れない
  if (tokens?.accessToken === undefined || tokens.accessToken.length === 0) return undefined;
  // tokenType 未指定時は Bearer を既定にする
  const tokenType = tokens.tokenType ?? "Bearer";
  // HTTP Authorization ヘッダ値を返す
  return `${tokenType} ${tokens.accessToken}`;
}
