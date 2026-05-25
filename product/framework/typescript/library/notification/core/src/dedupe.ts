// 通知ユニオン型を取り込み
import type { Notification } from "./types.js";

// queue から dedupeKey が一致する既存の通知を探す
// 戻り値: 一致した index と通知本体。見つからなければ -1 / undefined
export function findByDedupeKey(
  // 探索対象のキュー
  queue: readonly Notification[],
  // 探索する dedupeKey
  key: string,
): { index: number; notification: Notification } | null {
  // 線形探索（キュー長は maxQueueSize に制限されるため許容）
  for (let i = 0; i < queue.length; i++) {
    // 各要素を取得（範囲内の index なので必ず存在。noUncheckedIndexedAccess による undefined 型は ! で除去）
    const item = queue[i]!;
    // キーが一致すれば結果を返す
    if (item.dedupeKey === key) {
      return { index: i, notification: item };
    }
  }
  // 見つからない
  return null;
}
