// 公開型を取り込み
import type { OutboxEntry, OutboxLogger, OutboxStorage } from "./types.js";
// 永続化失敗時の統一エラー
import { OutboxError } from "./errors.js";

// KvStore 風の最小 I/F (storage/core の KvStore<unknown> を duck-typed で受ける)
// 実装依存を避けるため、import type ですら storage/core を参照しない
export interface KvStoreLike {
  // 値を取得 (未保存なら undefined)
  get(key: string): Promise<unknown>;
  // 値を保存
  set(key: string, value: unknown): Promise<void>;
  // 値を削除
  remove(key: string): Promise<void>;
}

// createOutboxStorage の生成オプション
export interface CreateOutboxStorageOptions {
  // キーのプレフィックス (既定 "outbox")
  namespace?: string;
  // index と本体の乖離 (本体未保存だが index に ID が残っている) を検出時に通知する logger
  // 運用監視のため、起動時の整合性チェックや list 呼び出しで warn を出せるようにする
  logger?: OutboxLogger;
}

// index 操作用の内部キー (chains Map のキーに使用)
const INDEX_LOCK_KEY = "__index__";

// KvStore<unknown> を Outbox 用にラップして OutboxStorage<T> を返す
// - エントリ本体: `${ns}:entry:${id}`
// - DLQ 本体:    `${ns}:dlq:${id}`
// - index 配列:  `${ns}:index` / `${ns}:dlq-index`
// - 同一 id への操作は withLock(id, op) で直列化される
// - index 更新は __index__ ロック下で read-modify-write
export function createOutboxStorage<T = unknown>(
  // 永続化バックエンド (KvStoreLike を満たす任意実装)
  kv: KvStoreLike,
  // 任意オプション
  options?: CreateOutboxStorageOptions,
): OutboxStorage<T> {
  // namespace の決定 (既定 "outbox")
  const namespace = options?.namespace ?? "outbox";
  // 乖離検出時に呼び出す logger (任意)
  const logger = options?.logger;

  // kv 呼び出しを実行し、失敗時は OutboxError(PERSISTENCE_FAILED) でラップして throw する
  // 内部 KV (localStorage / AsyncStorage / 任意実装) からの例外を統一的に表現する
  const wrapKvError = async <R>(
    // 操作種別 (エラーメッセージに含める)
    op: "get" | "set" | "remove",
    // 対象キー
    key: string,
    // 実行する非同期関数
    run: () => Promise<R>,
  ): Promise<R> => {
    try {
      return await run();
    } catch (err) {
      // 既に OutboxError なら再ラップしない (上層からの伝播)
      if (err instanceof OutboxError) {
        throw err;
      }
      // KV 由来の例外を OutboxError に統一して throw
      throw new OutboxError({
        code: "OUTBOX_PERSISTENCE_FAILED",
        message: `outbox storage ${op} failed for key "${key}"`,
        retryable: false,
        cause: err,
      });
    }
  };
  // キー組み立てヘルパ (本体側)
  const entryKey = (id: string): string => `${namespace}:entry:${id}`;
  // キー組み立てヘルパ (DLQ 側)
  const dlqKey = (id: string): string => `${namespace}:dlq:${id}`;
  // 本体 index キー
  const indexKey = `${namespace}:index`;
  // DLQ index キー
  const dlqIndexKey = `${namespace}:dlq-index`;

  // キーごとの直列化チェーン (前段 tail を待ってから op を実行)
  const chains: Map<string, Promise<unknown>> = new Map();

  // キー単位に op を直列化する
  const runSerially = async <R>(key: string, op: () => Promise<R>): Promise<R> => {
    // 前段 tail を取り出す (なければ即 resolve から始める)
    const prev = chains.get(key) ?? Promise.resolve();
    // 前段が成功/失敗どちらでも op を実行するよう then の両分岐に op を渡す
    const next: Promise<R> = prev.then(
      () => op(),
      () => op(),
    );
    // tail を更新 (次に登録される op はこの next を待つ)
    chains.set(key, next);
    try {
      // 自身の op 完了を待つ
      return await next;
    } finally {
      // 末尾のままなら Map から削除して chain が伸びるのを防ぐ
      if (chains.get(key) === next) {
        chains.delete(key);
      }
    }
  };

  // index 配列を取得する (未保存なら空配列)
  const readIndex = async (key: string): Promise<string[]> => {
    // 生値を取得 (KV 例外は PERSISTENCE_FAILED でラップ)
    const raw = await wrapKvError("get", key, () => kv.get(key));
    // 未保存または配列でなければ空配列とみなす
    if (!Array.isArray(raw)) {
      return [];
    }
    // 要素は文字列 ID のみ許容 (それ以外は破棄)
    return raw.filter((v): v is string => typeof v === "string");
  };

  // index 配列を保存する
  const writeIndex = async (key: string, ids: string[]): Promise<void> => {
    // 空配列も忠実に保存する (型整合のため)
    await wrapKvError("set", key, () => kv.set(key, ids));
  };

  // 本体 index に id を追加 (既存なら何もしない)
  const indexAdd = async (ids: string, isDlq: boolean): Promise<void> => {
    // 操作対象の index キーを決定
    const key = isDlq ? dlqIndexKey : indexKey;
    // 現在の配列を取得
    const current = await readIndex(key);
    // 既に含まれていれば書き戻し不要
    if (current.includes(ids)) {
      return;
    }
    // 末尾に追加
    current.push(ids);
    // 永続化
    await writeIndex(key, current);
  };

  // index から id を削除 (存在しなければ no-op)
  const indexRemove = async (id: string, isDlq: boolean): Promise<void> => {
    // 操作対象の index キーを決定
    const key = isDlq ? dlqIndexKey : indexKey;
    // 現在の配列を取得
    const current = await readIndex(key);
    // 該当 index を探す
    const i = current.indexOf(id);
    // 含まれていなければ書き戻し不要
    if (i < 0) {
      return;
    }
    // 該当要素を取り除く
    current.splice(i, 1);
    // 永続化
    await writeIndex(key, current);
  };

  // ID 指定でエントリを取得 (本体側)
  const load = async (id: string): Promise<OutboxEntry<T> | undefined> => {
    // 生値を取得 (KV 例外は PERSISTENCE_FAILED でラップ)
    const raw = await wrapKvError("get", entryKey(id), () => kv.get(entryKey(id)));
    // 未保存なら undefined
    if (raw === undefined || raw === null) {
      return undefined;
    }
    // 型注釈なしで返す (永続化時は OutboxEntry<T> を JSON 化している想定)
    return raw as OutboxEntry<T>;
  };

  // DLQ 側のエントリを取得
  const loadFromDlq = async (id: string): Promise<OutboxEntry<T> | undefined> => {
    // 生値を取得
    const raw = await wrapKvError("get", dlqKey(id), () => kv.get(dlqKey(id)));
    // 未保存なら undefined
    if (raw === undefined || raw === null) {
      return undefined;
    }
    // 型変換して返す
    return raw as OutboxEntry<T>;
  };

  // エントリを保存 (本体側、index にも反映)
  const save = async (entry: OutboxEntry<T>): Promise<void> => {
    // 本体キーへ JSON 化される値を直接書き込む (codec の責務は外側 kv 側で吸収)
    await wrapKvError("set", entryKey(entry.id), () => kv.set(entryKey(entry.id), entry));
    // index に id を追加 (__index__ ロックで競合防止)
    await runSerially(INDEX_LOCK_KEY, () => indexAdd(entry.id, false));
  };

  // エントリを完全削除 (本体 + DLQ どちらにあっても両方から消す)
  const remove = async (id: string): Promise<void> => {
    // 本体側を削除
    await wrapKvError("remove", entryKey(id), () => kv.remove(entryKey(id)));
    // DLQ 側も削除 (本体と DLQ 両方に存在することはないが念のため)
    await wrapKvError("remove", dlqKey(id), () => kv.remove(dlqKey(id)));
    // index からも除去 (両方)
    await runSerially(INDEX_LOCK_KEY, async () => {
      await indexRemove(id, false);
      await indexRemove(id, true);
    });
  };

  // 一覧取得 (fromDlq=true なら DLQ 側を返す)
  const list = async (fromDlq?: boolean): Promise<readonly OutboxEntry<T>[]> => {
    // 取得対象の index キー
    const key = fromDlq === true ? dlqIndexKey : indexKey;
    // index を取得
    const ids = await readIndex(key);
    // 各 ID のエントリを並列に取得
    const results: OutboxEntry<T>[] = [];
    // forEach ではなく for...of で順序を保ちつつ awaiat
    for (const id of ids) {
      // 該当キーから生値を取得 (KV 例外は PERSISTENCE_FAILED でラップ)
      const key = fromDlq === true ? dlqKey(id) : entryKey(id);
      const raw = await wrapKvError("get", key, () => kv.get(key));
      // 未保存 (index と本体が乖離した稀ケース) はスキップ
      if (raw === undefined || raw === null) {
        // 乖離は monitorable な事象なので logger.warn で運用者に通知
        logger?.warn("outbox: index/entry mismatch (entry missing for indexed id)", {
          id,
          fromDlq: fromDlq === true,
        });
        continue;
      }
      // 配列に積む
      results.push(raw as OutboxEntry<T>);
    }
    // 不変として返す
    return results;
  };

  // DLQ への移動 (本体 → DLQ 側にコピーして本体を削除)
  const moveToDlq = async (id: string): Promise<void> => {
    // 本体からエントリを取得
    const entry = await load(id);
    // 本体に無ければ移動できない (no-op)
    if (entry === undefined) {
      return;
    }
    // DLQ 側へ書き込み (KV 例外は PERSISTENCE_FAILED でラップ)
    await wrapKvError("set", dlqKey(id), () => kv.set(dlqKey(id), entry));
    // 本体側を削除
    await wrapKvError("remove", entryKey(id), () => kv.remove(entryKey(id)));
    // index も切り替え (本体から除去、DLQ index に追加)
    await runSerially(INDEX_LOCK_KEY, async () => {
      await indexRemove(id, false);
      await indexAdd(id, true);
    });
  };

  // DLQ からの復帰 (DLQ → 本体側にコピーして DLQ 側を削除)
  const restoreFromDlq = async (id: string): Promise<void> => {
    // DLQ からエントリを取得
    const entry = await loadFromDlq(id);
    // DLQ に無ければ復帰できない (no-op)
    if (entry === undefined) {
      return;
    }
    // 本体側へ書き込み
    await wrapKvError("set", entryKey(id), () => kv.set(entryKey(id), entry));
    // DLQ 側を削除
    await wrapKvError("remove", dlqKey(id), () => kv.remove(dlqKey(id)));
    // index も切り替え
    await runSerially(INDEX_LOCK_KEY, async () => {
      await indexRemove(id, true);
      await indexAdd(id, false);
    });
  };

  // 指定キーに対する操作を直列化する (manager から read-modify-write 用に使う)
  const withLock = <R>(id: string, op: () => Promise<R>): Promise<R> => {
    // chains Map を使った同一キー直列化
    return runSerially(id, op);
  };

  // 完成した OutboxStorage を返す
  return {
    // load は本体側を優先し、無ければ DLQ 側も探索する (get API として汎用化)
    async load(id: string): Promise<OutboxEntry<T> | undefined> {
      // 本体側を確認
      const found = await load(id);
      // 本体になければ DLQ も探索
      if (found !== undefined) {
        return found;
      }
      // DLQ も含めて検索
      return loadFromDlq(id);
    },
    save,
    remove,
    list,
    moveToDlq,
    restoreFromDlq,
    withLock,
  };
}
