// crypto.randomUUID の型を緩く受けるためのグローバル定義
type CryptoLike = { randomUUID?: () => string };

// 既定の ID 生成関数を作成する
// crypto.randomUUID が利用可能ならそれを使い、未対応環境では Math.random ベースの擬似 UUID を返す
export function createDefaultIdFactory(): () => string {
  // crypto は Node 19+ / モダンブラウザで globalThis に存在する
  const cryptoLike = (globalThis as { crypto?: CryptoLike }).crypto;
  // randomUUID が関数として提供されていれば常にそれを使う
  if (cryptoLike !== undefined && typeof cryptoLike.randomUUID === "function") {
    // 関数参照をキャプチャしておくことで instance binding を保つ
    const fn = cryptoLike.randomUUID.bind(cryptoLike);
    // クロージャ越しに呼び出して文字列を返す
    return () => fn();
  }
  // 未対応環境向けのフォールバック（衝突確率は極めて低いが暗号学的安全ではない）
  return fallbackId;
}

// Math.random ベースの擬似 UUID 生成（フォールバック用、export して直接テストも可能にする）
export function fallbackId(): string {
  // 16 進文字列のセグメントを 4 つ作って連結（UUID v4 風）
  const seg = (length: number): string => {
    // 0..1 の乱数を 16 進化（最大 13 文字）し、必要長を切り出す
    return Math.random().toString(16).slice(2, 2 + length).padStart(length, "0");
  };
  // 8-4-4-4-12 形式で連結
  return `${seg(8)}-${seg(4)}-${seg(4)}-${seg(4)}-${seg(12)}`;
}
