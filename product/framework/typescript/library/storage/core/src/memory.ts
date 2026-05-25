// 公開型を取り込み
import type { KvStore } from "./types.js";

// メモリ上に値を保持する KvStore を生成する
// initial: 初期値マップ (省略可、コピーして内部 Map に格納する)
export function createMemoryStore<T>(initial?: Readonly<Record<string, T>>): KvStore<T> {
  // 内部状態となる Map (キー: string、値: T)
  const map = new Map<string, T>();
  // 初期値が与えられていればコピーして格納する
  if (initial !== undefined) {
    // Object.keys で全エントリを走査
    for (const key of Object.keys(initial)) {
      // 値を取り出して map にセットする (型はジェネリクスで保証)
      map.set(key, initial[key] as T);
    }
  }
  // 変更通知の購読者集合 (Set で重複防止 + 高速 add/delete)
  const listeners = new Set<(key: string, next: T | undefined, prev: T | undefined) => void>();
  // 単一の変更を全リスナーに配信する内部ヘルパ
  const notify = (key: string, next: T | undefined, prev: T | undefined): void => {
    // リスナー集合の現在のスナップショットを走査 (走査中の add/delete で影響を受けないよう配列化)
    for (const listener of Array.from(listeners)) {
      // 個別のリスナーを呼び出す (例外は伝播させて呼び出し側の問題として表出)
      listener(key, next, prev);
    }
  };
  // KvStore 契約を返す
  return {
    // 指定キーの値を取得する
    async get(key: string): Promise<T | undefined> {
      // map.get は未保存時に undefined を返すので素直に返却する
      return map.get(key);
    },
    // 指定キーへ値を保存する
    async set(key: string, value: T): Promise<void> {
      // 通知に使う直前値を保持しておく (未保存なら undefined)
      const prev = map.get(key);
      // 新しい値を格納する
      map.set(key, value);
      // 購読者へ通知する (新規/更新を問わず一律発火)
      notify(key, value, prev);
    },
    // 指定キーの値を削除する
    async remove(key: string): Promise<void> {
      // 未保存キーへの remove は通知も発火させない (no-op)
      if (!map.has(key)) return;
      // 削除前の値を退避する (通知に使う)
      const prev = map.get(key);
      // map から削除する
      map.delete(key);
      // 購読者へ通知する (削除なので next は undefined)
      notify(key, undefined, prev);
    },
    // 指定キーが保存済みかを判定する
    async has(key: string): Promise<boolean> {
      // Map.has の結果をそのまま返す
      return map.has(key);
    },
    // 保存済みキーの一覧を返す
    async keys(): Promise<readonly string[]> {
      // Map のキーを配列化して返す (呼び出し側で freeze は要求しない)
      return Array.from(map.keys());
    },
    // 全エントリを削除する
    async clear(): Promise<void> {
      // 通知のため、削除前のエントリを退避する
      const snapshot = Array.from(map.entries());
      // 一括削除する
      map.clear();
      // 退避した各エントリについて削除通知を発火する
      for (const [key, prev] of snapshot) {
        // 削除なので next は undefined
        notify(key, undefined, prev);
      }
    },
    // 変更通知を購読する
    subscribe(listener): () => void {
      // 集合に追加する (同じ関数を 2 回 add しても Set なので 1 つ)
      listeners.add(listener);
      // 解除関数を返す
      return () => {
        // 集合から削除する (既に解除済みなら no-op)
        listeners.delete(listener);
      };
    },
  };
}
