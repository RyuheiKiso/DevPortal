// CameraEvent / CameraListener の型は types.ts に集約。実体は manager 内部で生成・配信
import type { CameraEvent, CameraListener } from "./types.js";

// 簡易 EventEmitter（subscribe / emit / dispose のみ）
// 各 listener の throw は他 listener の配信を妨げないように catch する
export class CameraEventEmitter {
  // 登録済みリスナの Set（FIFO 順を保証）
  private readonly listeners: Set<CameraListener> = new Set();

  // リスナを購読する（戻り値で購読解除）
  subscribe(listener: CameraListener): () => void {
    // 同一参照は 1 度しか登録されない
    this.listeners.add(listener);
    // 解除関数を返す
    return () => {
      // delete は存在しなくても false を返すだけで安全
      this.listeners.delete(listener);
    };
  }

  // 全リスナへイベントを配信する
  emit(event: CameraEvent): void {
    // listener の throw が伝播しないように 1 つずつ try で囲む
    for (const listener of this.listeners) {
      try {
        // 同期的に呼び出し
        listener(event);
      } catch {
        // 例外は握りつぶす（emit の責務は配信のみ）
      }
    }
  }

  // 全リスナを削除（manager.dispose で呼ぶ）
  clear(): void {
    // Set を空にする
    this.listeners.clear();
  }

  // 登録数の取得（テスト用）
  size(): number {
    // Set のサイズをそのまま返す
    return this.listeners.size;
  }
}
