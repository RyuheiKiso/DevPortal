// 公開型を取り込み
import type { KvStore } from "./types.js";

// 書き込みポリシー
// writeThrough (既定): 両ティアへ同期的に書き込み完了を待ってから resolve
// writeBehind: tier1 への書き込み完了で resolve、tier2 はバックグラウンド書き込み (await されない)
export type WriteThroughPolicy = "writeThrough" | "writeBehind";

// withReadThroughCache の生成オプション
export interface WithReadThroughCacheOptions<T> {
  // 高速側 KvStore (例: メモリ)
  tier1: KvStore<T>;
  // 永続側 KvStore (例: localStorage / IndexedDB)
  tier2: KvStore<T>;
  // 書き込みポリシー (既定: writeThrough)
  writePolicy?: WriteThroughPolicy;
}

// 2 階層キャッシュの KvStore を生成する
// 読み出し: tier1 → tier2 の順に検索し、tier2 命中時は tier1 を充填する (read-through)
// 書き込み: writeThrough または writeBehind で 2 ティアを更新
export function withReadThroughCache<T>(
  // 生成オプション
  options: WithReadThroughCacheOptions<T>,
): KvStore<T> {
  // 各ティアを取り出す
  const tier1 = options.tier1;
  const tier2 = options.tier2;
  // 書き込みポリシー (既定 writeThrough)
  const policy = options.writePolicy ?? "writeThrough";
  // 完成した KvStore を組み立てる
  const store: KvStore<T> = {
    // 取得: tier1 hit → 即返却、miss → tier2 を見て、hit なら tier1 を充填
    async get(key: string): Promise<T | undefined> {
      // 高速側で取得を試みる
      const cached = await tier1.get(key);
      // tier1 hit なら即返却
      if (cached !== undefined) return cached;
      // miss なら永続側を見る
      const persisted = await tier2.get(key);
      // tier2 も miss なら undefined
      if (persisted === undefined) return undefined;
      // tier2 hit を tier1 に充填する (await して整合性を保つ)
      await tier1.set(key, persisted);
      // 値を返す
      return persisted;
    },
    // 保存: ポリシーに従って 2 ティアを更新
    async set(key: string, value: T): Promise<void> {
      // 高速側は常に同期的に書き込む
      await tier1.set(key, value);
      // 永続側はポリシー次第
      if (policy === "writeThrough") {
        // writeThrough: 完了を待ってから resolve
        await tier2.set(key, value);
        // 完了
        return;
      }
      // writeBehind: 待たずに発火 (失敗は logger/audit などで拾うのが望ましい)
      void tier2.set(key, value);
    },
    // 削除: 両ティアから消す (writeThrough 相当を採用)
    async remove(key: string): Promise<void> {
      // 高速側を削除
      await tier1.remove(key);
      // 永続側も削除
      await tier2.remove(key);
    },
  };
  // 両ティアが has をサポートする場合のみ has を提供
  if (tier1.has !== undefined && tier2.has !== undefined) {
    const tier1Has = tier1.has;
    const tier2Has = tier2.has;
    store.has = async (key: string): Promise<boolean> => {
      // tier1 で見つかれば即 true
      if (await tier1Has(key)) return true;
      // tier2 で確認
      return tier2Has(key);
    };
  }
  // 永続側 (tier2) が keys をサポートする場合のみ keys を提供
  if (tier2.keys !== undefined) {
    const tier2Keys = tier2.keys;
    store.keys = async (): Promise<readonly string[]> => tier2Keys();
  }
  // 両ティアが clear をサポートする場合のみ clear を提供
  if (tier1.clear !== undefined && tier2.clear !== undefined) {
    const tier1Clear = tier1.clear;
    const tier2Clear = tier2.clear;
    store.clear = async (): Promise<void> => {
      // 高速側を先にクリア
      await tier1Clear();
      // 永続側もクリア
      await tier2Clear();
    };
  }
  // 完成した KvStore を返す
  return store;
}
