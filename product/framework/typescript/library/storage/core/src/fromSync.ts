// 公開型を取り込み
import type { KvStore, SyncStorage } from "./types.js";

// SyncStorage 互換 (Storage / AsyncStorage / 自作 Map ラッパ) を統一非同期 KvStore へ昇格する
// 戻り値は KvStore<string> 固定 (値の型付けは withCodec を被せて行う)
// inner.length / inner.key(i) が利用可能な場合のみ keys() を提供する
export function createSyncBacked(inner: SyncStorage): KvStore<string> {
  // KvStore 契約を返す
  const store: KvStore<string> = {
    // 指定キーの値を取得する
    async get(key: string): Promise<string | undefined> {
      // inner.getItem は sync/async どちらも返しうるので await で正規化する
      const raw = await Promise.resolve(inner.getItem(key));
      // null (未保存) は KvStore 契約の undefined に正規化する
      if (raw === null) return undefined;
      // 文字列はそのまま返却
      return raw;
    },
    // 指定キーへ値を保存する
    async set(key: string, value: string): Promise<void> {
      // inner.setItem の戻り値が Promise の場合に await できるよう Promise.resolve でラップ
      await Promise.resolve(inner.setItem(key, value));
    },
    // 指定キーの値を削除する
    async remove(key: string): Promise<void> {
      // inner.removeItem の戻り値が Promise の場合に await できるよう Promise.resolve でラップ
      await Promise.resolve(inner.removeItem(key));
    },
  };
  // length と key(i) が両方提供されている場合のみ keys() を提供する
  // (AsyncStorage は両方を持たないので keys() なし)
  if (typeof inner.length === "number" && typeof inner.key === "function") {
    // keys メソッドを差し込む
    // 注意: inner.key は this バインドを必要とするバックエンド (jsdom の Storage 等) があるため、
    // 必ず `inner.key(i)` という形で呼び出して this を inner に維持する
    store.keys = async (): Promise<readonly string[]> => {
      // 結果蓄積用の配列
      const result: string[] = [];
      // 現在の length を取り出す (number 確定)
      const total = inner.length as number;
      // 0..length-1 の各インデックスでキー名を取り出す
      for (let i = 0; i < total; i++) {
        // key(i) は null を返すことがあるので結果を変数で受ける (this バインドのため inner.key! を直接呼ぶ)
        const k = inner.key!(i);
        // null でなければ結果に追加
        if (k !== null) result.push(k);
      }
      // 結果配列を返す
      return result;
    };
    // clear メソッドも合わせて提供する (keys が取れるバックエンドのみ意味がある)
    store.clear = async (): Promise<void> => {
      // 列挙して全削除する (sync Storage の length は削除と共に変動するので、先にキーを退避)
      const snapshot: string[] = [];
      // 現在の length を取り出す
      const total = inner.length as number;
      // インデックス順にキーを集める
      for (let i = 0; i < total; i++) {
        // key(i) を取得 (null なら無視、this バインドのため inner.key! を直接呼ぶ)
        const k = inner.key!(i);
        // 非 null のみ退避
        if (k !== null) snapshot.push(k);
      }
      // 退避したキーを順次削除する
      for (const k of snapshot) {
        // removeItem は sync/async どちらも await で正規化
        await Promise.resolve(inner.removeItem(k));
      }
    };
  }
  // 完成した KvStore を返す
  return store;
}
