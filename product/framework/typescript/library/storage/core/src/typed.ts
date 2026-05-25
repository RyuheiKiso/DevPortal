// 公開型を取り込み
import type { KvStore, TypedSlot } from "./types.js";

// 既存 KvStore の特定キーを 1 つのスロットとして型付けする
// auth の TokenStore のように「1 つのキーに 1 つの型」を扱うときに使う
export function createTypedSlot<T>(store: KvStore<T>, key: string): TypedSlot<T> {
  // 完成した TypedSlot を組み立てる
  const slot: TypedSlot<T> = {
    // 保存値を取得する
    async get(): Promise<T | undefined> {
      // 内部 KvStore の get に key を固定して委譲
      return store.get(key);
    },
    // 値を保存する
    async set(value: T): Promise<void> {
      // 内部 KvStore の set に key を固定して委譲
      await store.set(key, value);
    },
    // 値を削除する
    async clear(): Promise<void> {
      // 内部 KvStore の remove に key を固定して委譲
      await store.remove(key);
    },
  };
  // 内部 KvStore が subscribe をサポートする場合のみ subscribe を提供する
  if (store.subscribe !== undefined) {
    // subscribe を取り出して later の closure で参照する (TS の narrowing 維持のため)
    const innerSubscribe = store.subscribe;
    // TypedSlot 側の subscribe を差し込む
    slot.subscribe = (listener: (next: T | undefined) => void): () => void => {
      // 内部の (key, next, prev) 形を (next) 形に変換するアダプタリスナー
      const adapter = (changedKey: string, next: T | undefined): void => {
        // スロットのキーに一致する変更のみ伝播
        if (changedKey === key) listener(next);
      };
      // 内部 KvStore へ購読し、解除関数を取り出す
      const unsubscribe = innerSubscribe(adapter);
      // 解除関数をそのまま返す
      return unsubscribe;
    };
  }
  // 完成した TypedSlot を返す
  return slot;
}

// TypedSlot を最小限の KvStore<T> として再公開する
// 利用シーン: TypedSlot を期待する API と KvStore を期待する API を橋渡ししたいとき
export function asKvStore<T>(slot: TypedSlot<T>, key: string): KvStore<T> {
  // 完成した KvStore を組み立てる
  const store: KvStore<T> = {
    // get: 自スロットのキー以外は未保存扱い
    async get(requestKey: string): Promise<T | undefined> {
      // キーが一致しない場合は undefined
      if (requestKey !== key) return undefined;
      // 一致時は slot.get で取得
      return slot.get();
    },
    // set: 自スロットのキー以外は no-op (slot のセマンティクスを変えない)
    async set(requestKey: string, value: T): Promise<void> {
      // キーが一致しない場合は何もしない
      if (requestKey !== key) return;
      // 一致時は slot.set へ委譲
      await slot.set(value);
    },
    // remove: 自スロットのキー以外は no-op
    async remove(requestKey: string): Promise<void> {
      // キーが一致しない場合は何もしない
      if (requestKey !== key) return;
      // 一致時は slot.clear へ委譲
      await slot.clear();
    },
    // has: get の結果から判定 (slot に has は無いため)
    async has(requestKey: string): Promise<boolean> {
      // キーが一致しなければ false
      if (requestKey !== key) return false;
      // 一致時は slot.get で undefined チェック
      const value = await slot.get();
      // undefined でなければ保存済み
      return value !== undefined;
    },
    // keys: スロットのキーのみを返す (常に 1 要素)
    async keys(): Promise<readonly string[]> {
      // 単一キーのみを含む配列を返す
      return [key];
    },
    // clear: slot.clear へ委譲
    async clear(): Promise<void> {
      // 単一キーなので slot.clear を呼ぶ
      await slot.clear();
    },
  };
  // 内部 slot が subscribe をサポートしていれば KvStore.subscribe を提供する
  if (slot.subscribe !== undefined) {
    // subscribe を取り出す (closure に確定型で持ち込む)
    const innerSubscribe = slot.subscribe;
    // KvStore.subscribe を差し込む
    store.subscribe = (
      listener: (key: string, next: T | undefined, prev: T | undefined) => void,
    ): () => void => {
      // KvStore.subscribe は prev を渡すが、slot.subscribe は next のみ → prev は undefined 固定
      const adapter = (next: T | undefined): void => {
        // 単一キーに固定して通知 (prev は undefined)
        listener(key, next, undefined);
      };
      // 内部 slot に購読し解除関数を取得する
      const unsubscribe = innerSubscribe(adapter);
      // 解除関数を返す
      return unsubscribe;
    };
  }
  // 完成した KvStore を返す
  return store;
}
