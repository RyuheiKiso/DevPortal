// 公開型を取り込み
import type { OutboxEntry, PublishContext, Publisher } from "./types.js";

// 何もしない publisher (テスト・初期化中のデフォルト用)
// 常に成功扱いになる
export function createNoopPublisher<T>(): Publisher<T> {
  // 受け取った entry/ctx を無視して即解決
  return async () => {
    // 何もせず解決する
    return;
  };
}

// 複数 publisher を順番に試行し、最初に成功したら完了とする
// すべて失敗した場合は最後の例外を再 throw する
export function composePublishers<T>(
  // 試行順に並んだ publisher 列 (最低 1 つ必要)
  publishers: readonly Publisher<T>[],
): Publisher<T> {
  // 配列が空の場合は明示的なエラー (ランタイム保護)
  if (publishers.length === 0) {
    throw new Error("composePublishers requires at least one publisher");
  }
  // 統合された publisher を返す
  return async (entry: OutboxEntry<T>, ctx: PublishContext): Promise<void> => {
    // 直近例外を保持 (全失敗時に再 throw)
    let lastErr: unknown = undefined;
    // 全 publisher を順次試行
    for (const p of publishers) {
      try {
        // 成功すれば即終了
        await p(entry, ctx);
        return;
      } catch (err) {
        // 失敗は記録して次へ進む
        lastErr = err;
      }
    }
    // 全部失敗 → 最後のエラーを伝播 (上位 publisher 側でリトライ判定)
    throw lastErr;
  };
}
