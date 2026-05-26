// 公開型を取り込み
import type { OutboxEntry } from "./types.js";

// DLQ への移動時にエントリへ反映する変更点を計算する純粋関数
// 永続化は manager / storage に委譲
export function buildDlqEntry<T>(
  // 移動対象の現エントリ
  entry: OutboxEntry<T>,
  // 直近エラー (任意) を lastError として保持
  lastError: { message: string; code?: string; at: number } | undefined,
  // 移動時刻 (epoch ms)
  now: number,
): OutboxEntry<T> {
  // immutable に新しい entry を返す
  return {
    // 既存フィールドを引き継ぎ
    ...entry,
    // 状態を dead に固定
    status: "dead",
    // 既に与えられた lastError を優先、なければ既存値を維持
    lastError: lastError ?? entry.lastError,
    // 更新時刻を更新
    updatedAt: now,
    // 次回試行時刻はクリア (DLQ では自動再送しない)
    nextAttemptAt: undefined,
  };
}

// DLQ からの復元時にエントリへ反映する変更点を計算する純粋関数
// attemptCount を 0 に、lastError をクリアして pending に戻す
export function buildRestoredEntry<T>(
  // 復元対象の現エントリ (DLQ 側に存在)
  entry: OutboxEntry<T>,
  // 復元時刻 (epoch ms)
  now: number,
): OutboxEntry<T> {
  // immutable に新しい entry を返す
  return {
    // 既存フィールドを引き継ぎ
    ...entry,
    // pending に戻す
    status: "pending",
    // 試行回数を 0 にリセット (再試行枠を新規に与える)
    attemptCount: 0,
    // 直近エラーをクリア
    lastError: undefined,
    // 次回試行時刻を now に設定 (すぐに対象化される)
    nextAttemptAt: now,
    // 更新時刻も更新
    updatedAt: now,
    // sentAt は念のためクリア (sent から復元するケースはないが防御)
    sentAt: undefined,
  };
}

// DLQ サイズが上限を超えていれば最古エントリ群の ID 列を返す (FIFO アーカイブ用)
// 永続化 (実際の削除) は呼び出し側で行う
export function selectAutoArchiveIds(
  // 現在の DLQ ID 一覧 (index 順)
  dlqIds: readonly string[],
  // 最大保持件数 (これを超える分は FIFO で削除候補)
  maxEntries: number,
): readonly string[] {
  // 上限以下なら削除不要
  if (dlqIds.length <= maxEntries) {
    return [];
  }
  // 先頭から (dlqIds.length - maxEntries) 件を削除候補とする
  return dlqIds.slice(0, dlqIds.length - maxEntries);
}
