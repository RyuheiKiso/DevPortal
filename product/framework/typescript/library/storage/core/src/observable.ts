// 公開型を取り込み
import type { KvStore } from "./types.js";

// withObservable が返す KvStore の拡張 I/F
// subscribe は必ず提供される (Required)
// emit は外部 (例: cross-tab event リスナー) から通知を注入するための公開エントリ
export interface KvStoreObservable<T> extends KvStore<T> {
  // 変更通知を購読する (subscribe を必須化)
  subscribe(listener: (key: string, next: T | undefined, prev: T | undefined) => void): () => void;
  // 外部から通知を発火する (cross-tab 連携用、内部 set/remove からも呼ばれる)
  emit(key: string, next: T | undefined, prev: T | undefined): void;
}

// withObservable の生成オプション
export interface WithObservableOptions {
  // cross-tab 連携のための emit を有効化するか (核となる挙動には影響しないがドキュメント上の意図を明示)
  crossTab?: boolean;
}

// 既存 KvStore に変更通知 (subscribe / emit) を付与するミドルウェアを生成する
// inner が既に subscribe を持っていても無視し、本ミドルウェアが通知の唯一の経路となる
// (二重通知を避けるため。inner.subscribe を活かしたいなら withObservable を被せない)
export function withObservable<T>(
  // 生成オプション (省略可)
  _options?: WithObservableOptions,
): (inner: KvStore<T>) => KvStoreObservable<T> {
  // カリー化された wrapper を返す
  return (inner: KvStore<T>): KvStoreObservable<T> => {
    // 購読者集合 (Set で重複防止)
    const listeners = new Set<(key: string, next: T | undefined, prev: T | undefined) => void>();
    // 内部から listener へ通知する関数
    const emit = (key: string, next: T | undefined, prev: T | undefined): void => {
      // 走査中の add/delete で影響を受けないよう配列スナップショットを使う
      for (const listener of Array.from(listeners)) {
        // 個別のリスナーを呼び出す (例外は呼び出し側で扱う)
        listener(key, next, prev);
      }
    };
    // 完成した KvStoreObservable を組み立てる
    const wrapped: KvStoreObservable<T> = {
      // 取得は inner に委譲
      async get(key: string): Promise<T | undefined> {
        // inner の値をそのまま返す
        return inner.get(key);
      },
      // 保存: 変更前後の値を取得して emit する
      async set(key: string, value: T): Promise<void> {
        // 変更前の値を取得 (通知の prev に使う)
        const prev = await inner.get(key);
        // 値を保存
        await inner.set(key, value);
        // 購読者に通知
        emit(key, value, prev);
      },
      // 削除: 変更前の値を取得して emit する
      async remove(key: string): Promise<void> {
        // 変更前の値を取得 (通知の prev に使う)
        const prev = await inner.get(key);
        // 未保存キーへの remove は通知も発火させない (no-op)
        if (prev === undefined) {
          // inner には委譲する (バックエンドの判断に従う)
          await inner.remove(key);
          // 通知はスキップ
          return;
        }
        // 削除を inner に委譲
        await inner.remove(key);
        // 購読者に通知 (next は undefined)
        emit(key, undefined, prev);
      },
      // 購読: listener 集合に追加し、解除関数を返す
      subscribe(listener): () => void {
        // 集合に追加
        listeners.add(listener);
        // 解除関数を返す
        return () => {
          // 集合から削除 (二重解除でも no-op)
          listeners.delete(listener);
        };
      },
      // 外部からの通知発火 (cross-tab event リスナー等から呼ばれる)
      emit(key, next, prev): void {
        // 内部 emit と同じ動作 (公開シグネチャ)
        emit(key, next, prev);
      },
    };
    // inner.has があれば素通しで提供
    if (inner.has !== undefined) {
      const innerHas = inner.has;
      wrapped.has = async (key: string): Promise<boolean> => innerHas(key);
    }
    // inner.keys があれば素通しで提供
    if (inner.keys !== undefined) {
      const innerKeys = inner.keys;
      wrapped.keys = async (): Promise<readonly string[]> => innerKeys();
    }
    // inner.clear があれば、クリア前の全エントリで emit する
    if (inner.clear !== undefined && inner.keys !== undefined) {
      const innerClear = inner.clear;
      const innerKeys = inner.keys;
      wrapped.clear = async (): Promise<void> => {
        // 通知のためにキー一覧と各値を退避する
        const allKeys = await innerKeys();
        const snapshot: Array<[string, T | undefined]> = [];
        // 各キーの値を読み込んでスナップショット
        for (const k of allKeys) {
          // 値を取得 (未保存は undefined になりうる)
          const v = await inner.get(k);
          // スナップショットに記録
          snapshot.push([k, v]);
        }
        // 一括削除を実行
        await innerClear();
        // スナップショットを使って全キーの削除通知を発火
        for (const [k, prev] of snapshot) {
          // 削除なので next=undefined
          emit(k, undefined, prev);
        }
      };
    } else if (inner.clear !== undefined) {
      // keys が無いバックエンドでは listener への一括通知が出来ないため、clear のみ委譲する
      const innerClear = inner.clear;
      wrapped.clear = async (): Promise<void> => innerClear();
    }
    // 完成した KvStoreObservable を返す
    return wrapped;
  };
}
