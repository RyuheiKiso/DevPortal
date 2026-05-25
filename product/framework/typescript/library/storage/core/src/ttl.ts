// 公開型を取り込み
import type { KvStore } from "./types.js";

// withTtl が利用するエンベロープ形 (内部 KvStore に格納する形)
// value: 実値、expiresAt: 期限の絶対ミリ秒 (省略時は無期限)
export interface TtlEnvelope<T> {
  // 実値 (= 利用者から見える値)
  value: T;
  // 期限の絶対時刻 (ミリ秒)。省略時は期限なし
  expiresAt?: number;
}

// withTtl の生成オプション
export interface WithTtlOptions {
  // 既定 TTL (ミリ秒)。set 時に明示指定が無い場合に適用される (省略時は無期限)
  defaultTtlMs?: number;
  // 現在時刻を返す関数 (テスト固定化のため差し替え可能)
  now?: () => number;
}

// withTtl が返す KvStore の拡張 I/F
// 通常の KvStore<T> 操作に加えて、ttl を明示指定する setWithTtl を提供
export interface KvStoreWithTtl<T> extends KvStore<T> {
  // ttl 付きで値を保存する (ttlMs はミリ秒、保存後 ttlMs 経過で期限切れ)
  setWithTtl(key: string, value: T, ttlMs: number): Promise<void>;
}

// 期限付き保存ミドルウェアを生成する
// 内部 KvStore は TtlEnvelope<T> を格納し、外側 KvStore<T> は実値のみを公開する
// 読出し時に期限切れを検出すると遅延削除 (内部 remove) を行う
export function withTtl<T>(
  // 生成オプション (省略可)
  options?: WithTtlOptions,
): (inner: KvStore<TtlEnvelope<T>>) => KvStoreWithTtl<T> {
  // 既定 TTL (未指定なら undefined = 無期限)
  const defaultTtlMs = options?.defaultTtlMs;
  // 現在時刻関数 (未指定なら Date.now)
  const now = options?.now ?? (() => Date.now());
  // カリー化された wrapper を返す
  return (inner: KvStore<TtlEnvelope<T>>): KvStoreWithTtl<T> => {
    // 完成した KvStoreWithTtl を組み立てる
    const wrapped: KvStoreWithTtl<T> = {
      // 取得: 期限切れなら undefined を返し、遅延削除する
      async get(key: string): Promise<T | undefined> {
        // エンベロープを取得
        const envelope = await inner.get(key);
        // 未保存はそのまま undefined
        if (envelope === undefined) return undefined;
        // 期限切れ判定: expiresAt が指定されており、かつ現在時刻が期限以上のとき
        if (envelope.expiresAt !== undefined && now() >= envelope.expiresAt) {
          // 遅延削除 (期限切れエントリを掃除)
          await inner.remove(key);
          // 取得結果は undefined
          return undefined;
        }
        // 期限内なら実値を返す
        return envelope.value;
      },
      // 保存: defaultTtlMs が指定されていれば期限を設定し、未指定なら無期限
      async set(key: string, value: T): Promise<void> {
        // エンベロープを組み立てる
        const envelope: TtlEnvelope<T> = { value };
        // 既定 TTL があれば expiresAt を計算
        if (defaultTtlMs !== undefined) {
          // 現在時刻 + ttl を絶対時刻として保存
          envelope.expiresAt = now() + defaultTtlMs;
        }
        // inner に格納
        await inner.set(key, envelope);
      },
      // 削除: inner にそのまま委譲
      async remove(key: string): Promise<void> {
        // inner の remove
        await inner.remove(key);
      },
      // ttl を明示指定する保存
      async setWithTtl(key: string, value: T, ttlMs: number): Promise<void> {
        // 期限を計算したエンベロープを格納
        await inner.set(key, { value, expiresAt: now() + ttlMs });
      },
    };
    // inner.has があれば素通しで提供 (期限切れは get で除外されるが has は直接保存状態を返す)
    if (inner.has !== undefined) {
      // closure 固定
      const innerHas = inner.has;
      // has を差し込む
      wrapped.has = async (key: string): Promise<boolean> => innerHas(key);
    }
    // inner.keys があれば素通しで提供
    if (inner.keys !== undefined) {
      // closure 固定
      const innerKeys = inner.keys;
      // keys を差し込む
      wrapped.keys = async (): Promise<readonly string[]> => innerKeys();
    }
    // inner.clear があれば素通しで提供
    if (inner.clear !== undefined) {
      // closure 固定
      const innerClear = inner.clear;
      // clear を差し込む
      wrapped.clear = async (): Promise<void> => innerClear();
    }
    // inner.subscribe があれば、内部エンベロープを展開して外側へ通知
    if (inner.subscribe !== undefined) {
      // closure 固定
      const innerSubscribe = inner.subscribe;
      // subscribe を差し込む
      wrapped.subscribe = (
        listener: (key: string, next: T | undefined, prev: T | undefined) => void,
      ): () => void => {
        // エンベロープ通知を実値通知に変換するアダプタ
        const adapter = (
          key: string,
          next: TtlEnvelope<T> | undefined,
          prev: TtlEnvelope<T> | undefined,
        ): void => {
          // next の実値 (undefined はそのまま)
          const decodedNext = next === undefined ? undefined : next.value;
          // prev の実値
          const decodedPrev = prev === undefined ? undefined : prev.value;
          // 外側へ通知
          listener(key, decodedNext, decodedPrev);
        };
        // 内部に購読
        return innerSubscribe(adapter);
      };
    }
    // 完成した KvStoreWithTtl を返す
    return wrapped;
  };
}
