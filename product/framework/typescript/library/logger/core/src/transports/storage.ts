// storage パッケージから合成可能な部品を取り込み
import { createSyncBacked, jsonCodec, withCodec } from "@k1s0-ts-storage/core";
// 型を取り込み
import type { LogEntry, StorageAdapter, Transport } from "../types.js";

// StorageTransport の生成オプション
export interface StorageTransportOptions {
  // 永続化先となる KV ストア（同期/非同期どちらでも可）
  storage: StorageAdapter;
  // 保存先キー（既定: "k1s0-ts-logger:entries"）
  key?: string;
  // 最大件数（既定: 200）。超過時は古い順から削る
  maxEntries?: number;
  // JSON.stringify の replacer（既定: Error を自動シリアライズする実装）
  replacer?: (key: string, value: unknown) => unknown;
}

// 保存キーの既定値
const DEFAULT_KEY = "k1s0-ts-logger:entries";
// 最大件数の既定値
const DEFAULT_MAX_ENTRIES = 200;

// KV ストアにエントリを追記するトランスポートを生成
// 内部実装は @k1s0-ts-storage/core の createSyncBacked + jsonCodec + withCodec で合成
// JSON シリアライズの replacer 既定値 (Error 展開) は jsonCodec のデフォルトに揃えてある
export function createStorageTransport(opts: StorageTransportOptions): Transport {
  // 保存先キー
  const key = opts.key ?? DEFAULT_KEY;
  // 上限件数
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  // jsonCodec を組み立てる (replacer 指定があれば渡す、無ければデフォルト Error 展開を使う)
  const codec = jsonCodec<LogEntry[]>(opts.replacer !== undefined ? { replacer: opts.replacer } : undefined);
  // storage adapter を非同期 KvStore<string> へ昇格
  const backend = createSyncBacked(opts.storage);
  // codec を被せて KvStore<LogEntry[]> として扱う
  const store = withCodec<string, LogEntry[]>(codec)(backend);

  // 直列化キュー（read-modify-write の競合を防ぐため、書き込みを Promise チェインで順序保証）
  let chain: Promise<void> = Promise.resolve();

  // 実際の read-modify-write 処理（単一の write 呼び出しに対する純粋な作業）
  const performWrite = async (entry: LogEntry): Promise<void> => {
    // 既存配列を読み込む（壊れた JSON / 配列でない値はすべて空配列扱い）
    let existing: LogEntry[];
    try {
      // codec 経由で値を取得する (JSON.parse 失敗時は throw されるので catch)
      const decoded = await store.get(key);
      // 配列であることを確認 (object / number 等は空配列にフォールバック)
      existing = Array.isArray(decoded) ? decoded : [];
    } catch {
      // パース失敗 (壊れた JSON 等) は空配列で起動継続
      existing = [];
    }
    // 末尾に新規エントリを追加
    existing.push(entry);
    // 上限を超える場合は古い順から切り捨て（純粋に最新 N 件を保持）
    const kept = existing.length > maxEntries ? existing.slice(existing.length - maxEntries) : existing;
    // 配列を保存（codec が JSON 化を担当）
    await store.set(key, kept);
  };

  // Transport 契約を返す
  return {
    // 識別子
    name: "storage",
    // 1 件を追加して永続化（直前の write 完了後に開始することで競合を排除）
    write(entry) {
      // 直前の chain に続けて自身の write を繋ぐ
      const next = chain.then(() => performWrite(entry));
      // 次回 write のために、エラーを伝播させない形で chain を更新
      chain = next.catch(() => {
        // 失敗しても後続を止めないため握りつぶす（logger.ts 側で onTransportError に流れる）
      });
      // 呼出側（logger.ts safeWrite）が await できるよう、エラー込みの Promise を返す
      return next;
    },
    // 末尾まで書き込み完了を保証
    async flush() {
      // chain の末尾まで待機（chain は catch 済みなので reject にならない）
      await chain;
    },
    // dispose は flush と同等（明示的なリソースは持たない）
    async dispose() {
      // 末尾まで処理が終わるのを待つ
      await chain;
    },
  };
}
