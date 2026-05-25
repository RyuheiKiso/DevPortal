// core から KvStoreObservable 型を取り込み
import type { KvStoreObservable } from "@k1s0-ts-storage/core";

// attachStorageEvents のオプション
export interface AttachStorageEventsOptions<T> {
  // イベント発火元の Window (テスト容易化、省略時 globalThis.window)
  window?: Window;
  // 監視するキーのフィルタ (例: prefix 判定)。省略時は全イベントを受信
  keyFilter?: (key: string) => boolean;
  // storage event の string 値を T へ変換するデコーダ
  // 省略時は as 変換 (= T が string 前提)
  decode?: (raw: string | null) => T | undefined;
}

// window の `storage` イベントを KvStoreObservable.emit に橋渡しする
// 戻り値は購読解除関数 (component unmount で呼ぶ)
export function attachStorageEvents<T>(
  // 通知配送先 (withObservable 結果)
  observable: KvStoreObservable<T>,
  // オプション
  options?: AttachStorageEventsOptions<T>,
): () => void {
  // Window を解決 (注入 → globalThis.window)
  const win = options?.window ?? globalThis.window;
  // decode が未指定なら identity キャスト
  const decode =
    options?.decode ??
    ((raw: string | null): T | undefined => (raw === null ? undefined : (raw as unknown as T)));
  // storage event のリスナー本体
  const listener = (e: StorageEvent): void => {
    // key === null は localStorage.clear() を表す (他タブで一括削除された)
    // 個別 key 通知は出来ないので、ここではスキップする (registry.clearScope を使う設計を推奨)
    if (e.key === null) return;
    // フィルタ判定 (指定があれば適用)
    if (options?.keyFilter !== undefined && !options.keyFilter(e.key)) return;
    // 新値 / 旧値を decode
    const nextValue = decode(e.newValue);
    const prevValue = decode(e.oldValue);
    // observable に通知を伝搬
    observable.emit(e.key, nextValue, prevValue);
  };
  // イベント登録
  win.addEventListener("storage", listener);
  // 解除関数を返す
  return () => {
    // 登録を外す
    win.removeEventListener("storage", listener);
  };
}
