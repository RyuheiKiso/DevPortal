// 公開型を取り込み
import type { KvStore } from "./types.js";

// KvStore の全キーに prefix を自動付与するミドルウェアを生成する
// 利用シーン: 複数の論理スコープを 1 つのバックエンドに同居させる、衝突を防ぐ
// 例: withNamespace<string>("app")(localStorage) で "app:tokens" のように記録される
export function withNamespace<T>(prefix: string): (inner: KvStore<T>) => KvStore<T> {
  // 内側に挟む実体を構築するためのカリー化関数を返す
  return (inner: KvStore<T>): KvStore<T> => {
    // セパレータは ":" 固定 (将来オプション化する余地は残す)
    const separator = ":";
    // prefix が空文字なら識別子を変更せずに inner を素通しする
    // (degenerate case を扱うことで withNamespace("") の合成が安全になる)
    const apply = (key: string): string => (prefix === "" ? key : `${prefix}${separator}${key}`);
    // prefix を剥がすヘルパ (keys() の結果整形と subscribe の通知に使う)
    // 一致しないものは null を返し、呼び出し側で除外する
    const strip = (storedKey: string): string | null => {
      // prefix が空ならすべて素通し
      if (prefix === "") return storedKey;
      // 共通の prefix + separator から始まっていなければ null
      const head = `${prefix}${separator}`;
      // startsWith 判定で範囲外は除外
      if (!storedKey.startsWith(head)) return null;
      // 接頭辞を取り除いた残りを返す
      return storedKey.slice(head.length);
    };
    // 完成した KvStore を組み立てる
    const wrapped: KvStore<T> = {
      // 指定キー (論理) を prefix 付きで inner に問い合わせる
      async get(key: string): Promise<T | undefined> {
        // 物理キーへ変換して inner.get に委譲
        return inner.get(apply(key));
      },
      // 指定キー (論理) へ inner に書き込む
      async set(key: string, value: T): Promise<void> {
        // 物理キーへ変換して inner.set に委譲
        await inner.set(apply(key), value);
      },
      // 指定キー (論理) を inner から削除する
      async remove(key: string): Promise<void> {
        // 物理キーへ変換して inner.remove に委譲
        await inner.remove(apply(key));
      },
    };
    // inner が has を持つときのみ wrapped にも提供する (任意機能は伝播原則)
    if (inner.has !== undefined) {
      // has の参照を closure に固定 (narrowing 維持)
      const innerHas = inner.has;
      // 物理キーへ変換して inner.has に委譲
      wrapped.has = async (key: string): Promise<boolean> => innerHas(apply(key));
    }
    // inner が keys を持つときのみ wrapped にも提供する
    if (inner.keys !== undefined) {
      // keys の参照を closure に固定
      const innerKeys = inner.keys;
      // prefix 配下のキーのみを抽出して prefix を剥がして返す
      wrapped.keys = async (): Promise<readonly string[]> => {
        // 物理キー一覧を取得
        const all = await innerKeys();
        // strip で論理キーへ変換し、null (=範囲外) は除外する
        const result: string[] = [];
        // 配列を順次走査
        for (const physicalKey of all) {
          // 論理キーへ変換
          const logicalKey = strip(physicalKey);
          // null でなければ追加
          if (logicalKey !== null) result.push(logicalKey);
        }
        // 抽出結果を返す
        return result;
      };
    }
    // inner.keys が利用可能なときのみ wrapped に clear を提供する
    // (列挙不可なバックエンドで「namespace 配下だけ消す」は実現できないため)
    if (inner.keys !== undefined) {
      // keys を closure に固定
      const innerKeys = inner.keys;
      // clear は prefix 配下のキーだけ削除する
      wrapped.clear = async (): Promise<void> => {
        // 物理キーを列挙
        const all = await innerKeys();
        // prefix 配下のみを抽出 (strip で null になるものは除外)
        const targets: string[] = [];
        // 列挙結果を走査
        for (const physicalKey of all) {
          // strip で論理キーへ変換
          const logicalKey = strip(physicalKey);
          // 範囲内のみを削除対象に
          if (logicalKey !== null) targets.push(physicalKey);
        }
        // 1 件ずつ remove で削除 (物理キーをそのまま inner.remove に渡す)
        for (const physicalKey of targets) {
          // 物理キーで inner.remove を呼ぶ
          await inner.remove(physicalKey);
        }
      };
    }
    // inner が subscribe を持つときのみ wrapped にも提供する
    if (inner.subscribe !== undefined) {
      // subscribe を closure に固定
      const innerSubscribe = inner.subscribe;
      // wrapped.subscribe を差し込む
      wrapped.subscribe = (
        listener: (key: string, next: T | undefined, prev: T | undefined) => void,
      ): () => void => {
        // 物理キーの変更通知を論理キーに変換して伝搬するアダプタ
        const adapter = (storedKey: string, next: T | undefined, prev: T | undefined): void => {
          // 物理キーを論理キーに変換 (範囲外なら null)
          const logicalKey = strip(storedKey);
          // 範囲外 (null) は伝搬しない
          if (logicalKey === null) return;
          // 範囲内なら論理キーで通知する
          listener(logicalKey, next, prev);
        };
        // inner.subscribe を呼んで解除関数を取得
        const unsubscribe = innerSubscribe(adapter);
        // 解除関数を返す
        return unsubscribe;
      };
    }
    // 完成した KvStore を返す
    return wrapped;
  };
}
