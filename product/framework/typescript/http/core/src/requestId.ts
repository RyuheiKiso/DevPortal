// X-Request-Id 標準ヘッダ名（小文字でも大文字始まりでも OK だが代表表記で固定）
export const REQUEST_ID_HEADER = "X-Request-Id";

// crypto.randomUUID の最小型（任意の globalThis.crypto から safely 参照する用）
interface CryptoLike {
  // ブラウザ/Node の crypto.randomUUID 互換シグネチャ
  randomUUID?: () => string;
}

// 相関 ID を生成するヘルパ（X-Request-Id の値として利用）
// 既定実装は crypto.randomUUID() を優先し、無ければ Date + 乱数のフォールバック
export function createRequestId(): string {
  // globalThis から crypto を安全に取り出す（型は CryptoLike として絞り込み）
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  // randomUUID がある環境（ブラウザ / Node 19+ / vitest）はそれを採用
  if (c !== undefined && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  // フォールバック：epoch ms と乱数の連結で十分な衝突回避を確保
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
