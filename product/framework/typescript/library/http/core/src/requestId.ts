// X-Request-Id 標準ヘッダ名（小文字でも大文字始まりでも OK だが代表表記で固定）
// fetch 層では大小無視されるが、interceptor 内で参照するコードは大小厳密区別なので注意
export const REQUEST_ID_HEADER = "X-Request-Id";
// W3C trace-context 標準ヘッダ名（小文字固定が仕様）
export const TRACEPARENT_HEADER = "traceparent";

// crypto の最小型（任意の globalThis.crypto から safely 参照する用）
interface CryptoLike {
  // ブラウザ/Node の crypto.randomUUID 互換シグネチャ
  randomUUID?: () => string;
  // 16/8 バイトのランダム値を生成（traceparent 用）
  getRandomValues?: <T extends ArrayBufferView>(view: T) => T;
}

// Math.random フォールバックを使った旨を 1 度だけ warn するためのフラグ（C-A6 / M6）
// createRequestId と createTraceparent で共通利用する (同じプロセスで複数回 warn しないため)
// モジュールスコープ宣言は下記の bytesToHex の後に居るとホイスト順序で困るため先頭に移動
let warnedAboutWeakRandom = false;

// 弱い乱数源（Math.random）使用時の警告を 1 度だけ出すヘルパ
// reason: 「呼び出し元の関数名」を渡してログに含める (createRequestId / createTraceparent)
function warnWeakRandomOnce(reason: string): void {
  // 既に warn 済みなら何もしない (1 プロセス 1 回のみ)
  if (warnedAboutWeakRandom) return;
  warnedAboutWeakRandom = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[@k1s0-ts-http/core] crypto unavailable; falling back to Math.random for ${reason} (weak)`,
  );
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
  // フォールバック発生時に 1 度だけ警告 (一貫性のため createTraceparent と同じ仕組み、M6)
  warnWeakRandomOnce("request-id");
  // フォールバック：epoch ms と乱数の連結で十分な衝突回避を確保
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// バイナリ → hex 文字列変換ヘルパ（traceparent 用、各 byte を 2 hex に固定）
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    // Uint8Array の要素は必ず 0-255 の number（noUncheckedIndexedAccess の影響でキャストが必要）
    const b = bytes[i] as number;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

// crypto.getRandomValues を使って指定 byte 数のランダムバイト列を取得（フォールバックは Math.random）
// Math.random は暗号学的に弱いため、フォールバック時は warnWeakRandomOnce で警告を 1 度だけ出す
function randomBytes(len: number): Uint8Array {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  const out = new Uint8Array(len);
  if (c !== undefined && typeof c.getRandomValues === "function") {
    c.getRandomValues(out);
    return out;
  }
  // フォールバック発生時に 1 度だけ警告（trace-id 衝突や予測可能性のリスクを通知）
  warnWeakRandomOnce("trace-id");
  // フォールバック：Math.random 由来（暗号学的に弱いが trace 用途では実用範囲）
  for (let i = 0; i < len; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

// W3C trace-context の traceparent ヘッダ値を生成
// 形式: "00-<32hex traceId>-<16hex spanId>-01"
// version=00 / sampled=01 を固定で出力する（用途は HTTP リクエストの相関化）
export function createTraceparent(): string {
  // 16 バイト = 32 hex の trace-id
  const traceId = bytesToHex(randomBytes(16));
  // 8 バイト = 16 hex の span-id
  const spanId = bytesToHex(randomBytes(8));
  // sampled フラグを立てる（"01"）
  return `00-${traceId}-${spanId}-01`;
}
