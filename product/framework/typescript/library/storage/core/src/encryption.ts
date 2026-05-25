// 公開型を取り込み
import type { Codec, CryptoProvider, KvStore } from "./types.js";
// codec ファクトリを取り込み (既定 codec として stringCodec を使う)
import { stringCodec } from "./codec.js";

// withEncryption の生成オプション
export interface WithEncryptionOptions<T> {
  // 暗号化プロバイダ (鍵管理は外部で行う)
  provider: CryptoProvider;
  // 平文を文字列に変換する codec (省略時は stringCodec、つまり T=string 前提)
  codec?: Codec<T>;
  // true のときキー名を AAD に使う (同じ平文を別キーで保存しても改ざん検知可能になる)
  aadFromKey?: boolean;
}

// 文字列 ↔ Uint8Array の TextEncoder/TextDecoder インスタンス (関数内で生成すると毎回コスト)
// グローバルに存在する Web 標準 API を使う
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// Uint8Array を base64 文字列に変換する
function bytesToBase64(bytes: Uint8Array): string {
  // バイトを文字コード経由で文字列化
  let binary = "";
  // 各バイトを 1 文字に
  for (let i = 0; i < bytes.length; i++) {
    // String.fromCharCode は 0..255 を受け取る
    binary += String.fromCharCode(bytes[i] as number);
  }
  // btoa で base64 化
  return btoa(binary);
}

// base64 文字列を Uint8Array に戻す
function base64ToBytes(b64: string): Uint8Array {
  // atob でバイナリ風文字列に
  const binary = atob(b64);
  // 出力配列を準備
  const out = new Uint8Array(binary.length);
  // 各位置にバイトを設定
  for (let i = 0; i < binary.length; i++) {
    // charCodeAt は 0..255 を返す
    out[i] = binary.charCodeAt(i);
  }
  // 結果を返す
  return out;
}

// 暗号化エンベロープのバージョン番号 (将来のフォーマット変更検知用)
const ENVELOPE_VERSION = 1;

// JSON.parse 結果が暗号化エンベロープ形式であることを実行時検証する
// 改ざん検知の観点で、フィールド欠落 / 型違反は明示的に拒否する
function isEnvelope(value: unknown): value is { v: number; iv: string; ct: string } {
  // null / 非オブジェクトは不正
  if (value === null || typeof value !== "object") return false;
  // 各フィールドの型を個別に検証する
  const obj = value as { v?: unknown; iv?: unknown; ct?: unknown };
  // v は number 必須
  if (typeof obj.v !== "number") return false;
  // iv は string 必須
  if (typeof obj.iv !== "string") return false;
  // ct は string 必須
  if (typeof obj.ct !== "string") return false;
  // すべて満たせば正当なエンベロープ
  return true;
}

// inner KvStore<string> に暗号化エンベロープを格納し、外側 KvStore<T> として公開する
// 内部フォーマット: JSON({ v: 1, iv: base64, ct: base64 })
export function withEncryption<T>(
  // 生成オプション
  options: WithEncryptionOptions<T>,
): (inner: KvStore<string>) => KvStore<T> {
  // 暗号化プロバイダ
  const provider = options.provider;
  // 平文 codec (省略時は stringCodec、T=string 前提)
  const codec = (options.codec ?? stringCodec()) as Codec<T>;
  // AAD としてキー名を使うか
  const aadFromKey = options.aadFromKey === true;
  // キー名を AAD バイト列に変換する
  const keyToAad = (key: string): Uint8Array | undefined =>
    // 設定が無効なら undefined を返す (CryptoProvider 側に AAD 無しとして渡される)
    aadFromKey ? textEncoder.encode(key) : undefined;
  // カリー化された wrapper を返す
  return (inner: KvStore<string>): KvStore<T> => {
    // 完成した KvStore を組み立てる
    const wrapped: KvStore<T> = {
      // 取得: inner から JSON エンベロープを取り、復号して T を返す
      async get(key: string): Promise<T | undefined> {
        // 暗号文 (JSON 文字列) を取得
        const raw = await inner.get(key);
        // 未保存はそのまま undefined
        if (raw === undefined) return undefined;
        // JSON をパース (壊れた値は例外伝播)
        const parsed = JSON.parse(raw) as unknown;
        // エンベロープ形式の実行時検証 (改ざん検知のため失敗時は throw)
        if (!isEnvelope(parsed)) {
          // 開発者が即気付くようなメッセージで投げる
          throw new Error("Invalid encryption envelope: missing or wrong-typed fields");
        }
        // 検証済みのエンベロープを取得する
        const envelope = parsed;
        // バージョン不一致は明示的に例外 (フォーマット変更を検知)
        if (envelope.v !== ENVELOPE_VERSION) {
          // 開発者が即気付くようなメッセージで投げる
          throw new Error(`Unsupported encryption envelope version: ${envelope.v}`);
        }
        // base64 を Uint8Array に戻す
        const iv = base64ToBytes(envelope.iv);
        const ciphertext = base64ToBytes(envelope.ct);
        // 復号
        const plaintext = await provider.decrypt({ ciphertext, iv }, keyToAad(key));
        // 平文バイト列を utf-8 文字列に戻す
        const decoded = textDecoder.decode(plaintext);
        // codec で T に復元
        return codec.decode(decoded);
      },
      // 保存: codec.encode → encrypt → JSON エンベロープを inner に書く
      async set(key: string, value: T): Promise<void> {
        // 値を文字列にエンコード
        const encoded = codec.encode(value);
        // utf-8 バイト列に変換
        const plaintext = textEncoder.encode(encoded);
        // 暗号化
        const result = await provider.encrypt(plaintext, keyToAad(key));
        // base64 化して JSON エンベロープを組み立て
        const envelope = JSON.stringify({
          // バージョン (固定)
          v: ENVELOPE_VERSION,
          // IV (base64)
          iv: bytesToBase64(result.iv),
          // 暗号文 (base64)
          ct: bytesToBase64(result.ciphertext),
        });
        // inner に保存
        await inner.set(key, envelope);
      },
      // 削除: inner にそのまま委譲
      async remove(key: string): Promise<void> {
        // inner.remove
        await inner.remove(key);
      },
    };
    // 任意機能は素通し
    if (inner.has !== undefined) {
      const innerHas = inner.has;
      wrapped.has = async (key: string): Promise<boolean> => innerHas(key);
    }
    if (inner.keys !== undefined) {
      const innerKeys = inner.keys;
      wrapped.keys = async (): Promise<readonly string[]> => innerKeys();
    }
    if (inner.clear !== undefined) {
      const innerClear = inner.clear;
      wrapped.clear = async (): Promise<void> => innerClear();
    }
    // 完成した KvStore を返す
    return wrapped;
  };
}

// Web Crypto API ベースの AES-GCM CryptoProvider を生成する
// 鍵は呼び出し側で importKey 済みの CryptoKey を渡す
export function createAesGcmProvider(options: {
  // AES-GCM 用に importKey 済みの CryptoKey
  key: CryptoKey;
}): CryptoProvider {
  // CryptoKey を closure に固定
  const key = options.key;
  // CryptoProvider を返す
  return {
    // 暗号化
    async encrypt(plaintext: Uint8Array, aad?: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
      // IV は 12 バイト (AES-GCM 推奨)、毎回ランダムに生成
      const iv = crypto.getRandomValues(new Uint8Array(12));
      // AES-GCM パラメータ
      const params: AesGcmParams = { name: "AES-GCM", iv };
      // AAD が指定されていれば additionalData を設定
      if (aad !== undefined) params.additionalData = aad;
      // 暗号化を実行 (subtle.encrypt は ArrayBuffer を返す)
      const ciphertext = await crypto.subtle.encrypt(params, key, plaintext);
      // Uint8Array にラップして返す
      return { ciphertext: new Uint8Array(ciphertext), iv };
    },
    // 復号
    async decrypt(
      payload: { ciphertext: Uint8Array; iv: Uint8Array },
      aad?: Uint8Array,
    ): Promise<Uint8Array> {
      // AES-GCM パラメータ
      const params: AesGcmParams = { name: "AES-GCM", iv: payload.iv };
      // AAD 設定 (暗号化時と一致している必要あり)
      if (aad !== undefined) params.additionalData = aad;
      // 復号 (失敗時は OperationError が throw される)
      const plaintext = await crypto.subtle.decrypt(params, key, payload.ciphertext);
      // Uint8Array にラップして返す
      return new Uint8Array(plaintext);
    },
  };
}
