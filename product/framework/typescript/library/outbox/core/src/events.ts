// Outbox イベントとリスナの型を取り込み
import type { OutboxEvent, OutboxListener } from "./types.js";

// 簡易 EventEmitter (subscribe / emit / clear / size のみ)
// 各 listener の throw が他 listener への配信を妨げないように個別 try で囲む
export class OutboxEventEmitter<T = unknown> {
  // 登録済みリスナの集合 (FIFO 順を維持)
  private readonly listeners: Set<OutboxListener<T>> = new Set();

  // 購読を登録し、解除関数を返す
  subscribe(listener: OutboxListener<T>): () => void {
    // 同一参照は 1 度しか登録されない (Set の性質)
    this.listeners.add(listener);
    // 解除関数 (再呼び出しでも安全)
    return () => {
      // 削除のみ。存在しなくても Set#delete は false を返すだけで安全
      this.listeners.delete(listener);
    };
  }

  // 登録済み全 listener にイベントを配信する
  emit(event: OutboxEvent<T>): void {
    // 走査中に subscribe / unsubscribe が発生しても安全になるようスナップショットを取る
    const snapshot = Array.from(this.listeners);
    // 各 listener を順に呼び出す
    for (const listener of snapshot) {
      try {
        // 同期的に呼び出し (Promise を返しても await はしない)
        listener(event);
      } catch {
        // 1 つの listener の例外を他の listener に波及させない (配信の責務のみ)
      }
    }
  }

  // 全リスナを削除する (manager.dispose で呼ぶ)
  clear(): void {
    // Set を空にする
    this.listeners.clear();
  }

  // 登録済みリスナ数を返す (テスト用)
  size(): number {
    // Set のサイズをそのまま返す
    return this.listeners.size;
  }
}
