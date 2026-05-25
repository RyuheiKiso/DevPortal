// トークン保存先の型を取り込み
import type { AuthTokenSet, TokenStore } from "./types.js";

// メモリ上にトークンを保持する TokenStore を作る
export function createMemoryTokenStore(initial?: AuthTokenSet): TokenStore {
  // 現在値をクロージャに保持する
  let current = initial === undefined ? undefined : { ...initial };
  // TokenStore 契約を返す
  return {
    // 現在のトークンをコピーして返す
    async get(): Promise<AuthTokenSet | undefined> {
      // 未保存なら undefined を返す
      if (current === undefined) return undefined;
      // 外部 mutation を避けるためコピーを返す
      return { ...current };
    },
    // 新しいトークンを保存する
    async set(tokens: AuthTokenSet): Promise<void> {
      // 外部 mutation を避けるためコピーして保持する
      current = { ...tokens };
    },
    // 保存済みトークンを削除する
    async clear(): Promise<void> {
      // 現在値を未保存状態へ戻す
      current = undefined;
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
