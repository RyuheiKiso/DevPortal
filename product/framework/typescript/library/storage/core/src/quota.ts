// 公開型を取り込み
import type { KvStore, QuotaError } from "./types.js";
// エラーファクトリ / 判定を取り込み
import { createQuotaError, isQuotaExceededLike } from "./errors.js";

// クォータ超過時の決定 (アプリ側の戦略)
// retry: cleanup を試行してから set をリトライ
// throw: QuotaError を上位に伝播
// drop: エラーを握り潰して set 失敗を黙殺
export type QuotaDecision = "retry" | "throw" | "drop";

// withQuotaGuard の生成オプション
export interface WithQuotaGuardOptions<T> {
  // クォータ超過時の決定を返すコールバック
  // 戦略選択 + ログ出力 + cleanup 戦略の調整など、副作用ありで実装可能
  onQuotaExceeded?: (key: string, value: T, err: QuotaError) => QuotaDecision;
  // リトライ最大回数 (既定: 1)。retry 戦略で各 set 呼び出しごとに最大この回数まで再試行
  maxRetries?: number;
  // リトライ前に呼ばれる掃除 (TTL 期限切れ削除など)。retry 戦略のみ意味あり
  cleanup?: () => Promise<void>;
}

// クォータ超過 (QuotaExceededError) を捕捉して戦略に従って処理するミドルウェア
// 検出ロジックは isQuotaExceededLike を使う (Chrome/Safari/Edge/Firefox 互換)
export function withQuotaGuard<T>(
  // 生成オプション
  options?: WithQuotaGuardOptions<T>,
): (inner: KvStore<T>) => KvStore<T> {
  // 戦略コールバック (既定は throw)
  const onQuotaExceeded = options?.onQuotaExceeded ?? ((): QuotaDecision => "throw");
  // リトライ最大回数 (既定 1)
  const maxRetries = options?.maxRetries ?? 1;
  // cleanup (省略時は無処理)
  const cleanup = options?.cleanup;
  // カリー化された wrapper を返す
  return (inner: KvStore<T>): KvStore<T> => {
    // 完成した KvStore を組み立てる
    const wrapped: KvStore<T> = {
      // get は素通し (容量チェックは不要)
      async get(key: string): Promise<T | undefined> {
        // inner に委譲
        return inner.get(key);
      },
      // set は QuotaExceededError を捕捉する
      async set(key: string, value: T): Promise<void> {
        // リトライ済み回数
        let attempt = 0;
        // 最大 attempt = maxRetries まで内部リトライする (初回試行 + maxRetries 回リトライ)
        while (true) {
          // set を実行する
          try {
            // 内部に委譲
            await inner.set(key, value);
            // 成功したら終了
            return;
          } catch (caught) {
            // QuotaExceededError 様式に一致しなければ無加工で再 throw
            if (!isQuotaExceededLike(caught)) {
              // 想定外エラーは握り潰さず上位へ
              throw caught;
            }
            // QuotaError に正規化
            const quotaError = createQuotaError({ key, cause: caught });
            // 戦略コールバックの判断
            const decision = onQuotaExceeded(key, value, quotaError);
            // throw 戦略: 上位へ伝播
            if (decision === "throw") {
              // QuotaError を投げる (cause に元例外を保持)
              throw quotaError;
            }
            // drop 戦略: 何もせず resolve
            if (decision === "drop") {
              // set 失敗を黙殺
              return;
            }
            // ここから先は retry 戦略
            // 最大リトライ数を超えていれば、これ以上試さず throw に切り替える
            if (attempt >= maxRetries) {
              // リトライ上限を超えたので QuotaError を伝播
              throw quotaError;
            }
            // cleanup が指定されていれば実行 (例: TTL 期限切れ掃除)
            if (cleanup !== undefined) {
              // cleanup の失敗自体は上位へ伝播させる (デバッグ容易化のため握り潰さない)
              await cleanup();
            }
            // attempt をインクリメントして次の試行へ
            attempt++;
          }
        }
      },
      // remove は素通し (クォータと無関係)
      async remove(key: string): Promise<void> {
        // 内部に委譲
        await inner.remove(key);
      },
    };
    // inner.has があれば素通しで提供
    if (inner.has !== undefined) {
      const innerHas = inner.has;
      wrapped.has = async (key: string): Promise<boolean> => innerHas(key);
    }
    // inner.keys があれば素通しで提供
    if (inner.keys !== undefined) {
      const innerKeys = inner.keys;
      wrapped.keys = async (): Promise<readonly string[]> => innerKeys();
    }
    // inner.clear があれば素通しで提供
    if (inner.clear !== undefined) {
      const innerClear = inner.clear;
      wrapped.clear = async (): Promise<void> => innerClear();
    }
    // inner.subscribe があれば素通しで提供
    if (inner.subscribe !== undefined) {
      const innerSubscribe = inner.subscribe;
      wrapped.subscribe = (listener): () => void => innerSubscribe(listener);
    }
    // 完成した KvStore を返す
    return wrapped;
  };
}
