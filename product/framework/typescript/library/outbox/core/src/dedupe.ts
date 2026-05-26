// エントリ型を取り込み
import type { OutboxEntry } from "./types.js";

// 一覧から dedupeKey が一致する既存エントリを線形検索する
// 戻り値: 一致した index と entry。見つからなければ null
// (件数は scheduler.batchSize や DLQ 上限に制限されるため線形でも許容)
export function findEntryByDedupeKey<T>(
  // 探索対象の配列 (通常 storage.list(false) の結果)
  entries: readonly OutboxEntry<T>[],
  // 探索する dedupeKey
  key: string,
): { index: number; entry: OutboxEntry<T> } | null {
  // 線形探索 (短いキューを想定)
  for (let i = 0; i < entries.length; i++) {
    // 各要素を取得 (noUncheckedIndexedAccess の undefined 型を ! で除去)
    const entry = entries[i]!;
    // キー一致なら結果を返す
    if (entry.dedupeKey === key) {
      return { index: i, entry };
    }
  }
  // 見つからない
  return null;
}
