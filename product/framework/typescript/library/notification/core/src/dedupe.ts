// 通知ユニオン型を取り込み
import type { AppNotification } from "./types.js";

// queue から dedupeKey が一致する既存の通知を探す
// 戻り値: 一致した index と通知本体。見つからなければ null
//
// kindFilter:
//   "toast" / "dialog" / "confirm" を指定すると、その kind に一致した最初の通知のみを返す。
//   省略時は kind に関わらず最初の一致を返す (旧来の挙動)。
//
// 経緯: dedupeKey が異なる kind 間で衝突した場合、kind フィルタが無いと
// 例えば「先頭に dialog がある状態で同 key の toast を push しようとすると、
// dialog がヒットして toast の dedupe 経路が機能しない」事故が起きていた。
export function findByDedupeKey(
  // 探索対象のキュー
  queue: readonly AppNotification[],
  // 探索する dedupeKey
  key: string,
  // 任意: 一致を絞り込む kind (省略時は全 kind)
  kindFilter?: AppNotification["kind"],
): { index: number; notification: AppNotification } | null {
  // 線形探索（キュー長は maxQueueSize に制限されるため許容）
  for (let i = 0; i < queue.length; i++) {
    // 各要素を取得（範囲内の index なので必ず存在。noUncheckedIndexedAccess による undefined 型は ! で除去）
    const item = queue[i]!;
    // kindFilter 指定があれば一致する kind のみを採用する
    if (kindFilter !== undefined && item.kind !== kindFilter) continue;
    // キーが一致すれば結果を返す
    if (item.dedupeKey === key) {
      return { index: i, notification: item };
    }
  }
  // 見つからない
  return null;
}
