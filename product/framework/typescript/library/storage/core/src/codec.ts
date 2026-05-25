// 公開型を取り込み
import type { Codec, KvStore } from "./types.js";

// JSON.stringify の既定 replacer
// Error インスタンスを { name, message, stack } の plain object に展開する
// 循環参照や function 等の非対応値は標準挙動 (undefined 化) に委ねる
const defaultReplacer = (_key: string, value: unknown): unknown => {
  // Error 系は構造化できるよう name/message/stack を抜き出す
  if (value instanceof Error) {
    // 展開後の plain object を返す
    return { name: value.name, message: value.message, stack: value.stack };
  }
  // それ以外は無加工で返す
  return value;
};

// JSON codec を生成する
// options.replacer: encode 時の replacer (省略時は Error 展開用)
// options.reviver: decode 時の reviver (省略時は無変換)
// options.space: JSON.stringify の space (整形用、通常は省略)
export function jsonCodec<T>(options?: {
  // encode 時の replacer
  replacer?: (key: string, value: unknown) => unknown;
  // decode 時の reviver
  reviver?: (key: string, value: unknown) => unknown;
  // JSON 整形用 indent
  space?: string | number;
}): Codec<T> {
  // 値の参照 (options が undefined でも安全に扱う)
  const replacer = options?.replacer ?? defaultReplacer;
  // reviver は明示指定があれば使う
  const reviver = options?.reviver;
  // space は明示指定があれば使う
  const space = options?.space;
  // Codec 契約を返す
  return {
    // 値を JSON 文字列にエンコードする
    encode(value: T): string {
      // JSON.stringify は replacer / space を受け付ける
      return JSON.stringify(value, replacer, space);
    },
    // 文字列を JSON として T にデコードする
    decode(raw: string): T {
      // reviver の有無で呼び分け (JSON.parse の reviver 引数は undefined 非許容のため)
      if (reviver !== undefined) {
        // reviver 指定時
        return JSON.parse(raw, reviver) as T;
      }
      // reviver なし
      return JSON.parse(raw) as T;
    },
  };
}

// 文字列をそのまま扱う identity codec
// 用途: 既に文字列の値を KvStore<string> 型に乗せたいときの no-op
export function stringCodec(): Codec<string> {
  // Codec 契約を返す (encode/decode ともに恒等)
  return {
    // encode は無変換
    encode(value: string): string {
      // そのまま返す
      return value;
    },
    // decode も無変換
    decode(raw: string): string {
      // そのまま返す
      return raw;
    },
  };
}

// バイナリ風データを base64 でやりとりする codec
// 用途: encryption の出力 (Uint8Array) を文字列ストアに保存するときの橋渡し
export function base64Codec(): Codec<Uint8Array> {
  // Codec 契約を返す
  return {
    // Uint8Array を base64 文字列へエンコードする
    encode(value: Uint8Array): string {
      // バイト列を char code 経由で文字列化してから btoa で base64 化
      // Node 環境にも btoa はあるが万一の互換性のため try/catch ではなく明示判定する
      let binary = "";
      // 各バイトを 1 文字に変換する
      for (let i = 0; i < value.length; i++) {
        // String.fromCharCode は 0..255 を受ける
        binary += String.fromCharCode(value[i] as number);
      }
      // btoa で base64 文字列へ
      return btoa(binary);
    },
    // base64 文字列を Uint8Array へデコードする
    decode(raw: string): Uint8Array {
      // atob でバイナリ風文字列に戻す
      const binary = atob(raw);
      // 文字列の各文字を 0..255 のバイトに展開
      const out = new Uint8Array(binary.length);
      // 各位置のバイトを設定
      for (let i = 0; i < binary.length; i++) {
        // charCodeAt で 0..255 を取り出す
        out[i] = binary.charCodeAt(i);
      }
      // 完成した Uint8Array を返す
      return out;
    },
  };
}

// 内側 KvStore (string) と外側 KvStore<T> を codec で接続するミドルウェア
// 例: withCodec(jsonCodec<User>())(syncBackedLocalStorage)
export function withCodec<I extends string, O>(codec: Codec<O>): (inner: KvStore<I>) => KvStore<O> {
  // カリー化された wrapper を返す
  return (inner: KvStore<I>): KvStore<O> => {
    // 完成した KvStore を組み立てる
    const wrapped: KvStore<O> = {
      // 取得時は inner から文字列を取り出して decode
      async get(key: string): Promise<O | undefined> {
        // 文字列を取得
        const raw = await inner.get(key);
        // 未保存はそのまま undefined
        if (raw === undefined) return undefined;
        // decode して T を復元
        return codec.decode(raw);
      },
      // 保存時は encode して inner に書き込む
      async set(key: string, value: O): Promise<void> {
        // encode で文字列化
        const encoded = codec.encode(value);
        // I は string 系のため as でナローイング (encoded は実際に string)
        await inner.set(key, encoded as I);
      },
      // 削除はそのまま委譲
      async remove(key: string): Promise<void> {
        // inner.remove に渡す
        await inner.remove(key);
      },
    };
    // inner.has があれば素通しで提供する
    if (inner.has !== undefined) {
      // closure に確定型で固定
      const innerHas = inner.has;
      // has を差し込む
      wrapped.has = async (key: string): Promise<boolean> => innerHas(key);
    }
    // inner.keys があれば素通しで提供する
    if (inner.keys !== undefined) {
      // closure に確定型で固定
      const innerKeys = inner.keys;
      // keys を差し込む
      wrapped.keys = async (): Promise<readonly string[]> => innerKeys();
    }
    // inner.clear があれば素通しで提供する
    if (inner.clear !== undefined) {
      // closure に確定型で固定
      const innerClear = inner.clear;
      // clear を差し込む
      wrapped.clear = async (): Promise<void> => innerClear();
    }
    // inner.subscribe があれば decode を挟んで提供する
    if (inner.subscribe !== undefined) {
      // closure に確定型で固定
      const innerSubscribe = inner.subscribe;
      // subscribe を差し込む
      wrapped.subscribe = (
        listener: (key: string, next: O | undefined, prev: O | undefined) => void,
      ): () => void => {
        // 内部通知の文字列値を decode して外側へ伝搬するアダプタ
        const adapter = (key: string, next: I | undefined, prev: I | undefined): void => {
          // next を decode (undefined はそのまま)
          const decodedNext = next === undefined ? undefined : codec.decode(next);
          // prev を decode (undefined はそのまま)
          const decodedPrev = prev === undefined ? undefined : codec.decode(prev);
          // 外側リスナーへ伝搬
          listener(key, decodedNext, decodedPrev);
        };
        // 内部に購読
        const unsubscribe = innerSubscribe(adapter);
        // 解除関数を返す
        return unsubscribe;
      };
    }
    // 完成した KvStore を返す
    return wrapped;
  };
}
