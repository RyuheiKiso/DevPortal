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

// Error などを JSON で扱えるように展開する既定 replacer
const defaultReplacer = (_key: string, value: unknown): unknown => {
  // Error はメッセージとスタックを抜いた素直なオブジェクトに変換
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  // それ以外はそのまま返す
  return value;
};

// 受け取った文字列を LogEntry 配列に復元する（壊れた値は空配列にフォールバック）
function parseExisting(raw: string | null): LogEntry[] {
  // 値が無ければ空配列
  if (raw === null) {
    return [];
  }
  // JSON パース。失敗時は防衛的に空配列を返す
  try {
    // 任意の JSON を unknown として受ける
    const parsed = JSON.parse(raw) as unknown;
    // 配列であることを確認したうえで返す
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
  } catch {
    // パース失敗（壊れた JSON、想定外データ等）は空配列で起動し続ける
    return [];
  }
}

// KV ストアにエントリを追記するトランスポートを生成
export function createStorageTransport(opts: StorageTransportOptions): Transport {
  // 保存先キー
  const key = opts.key ?? DEFAULT_KEY;
  // 上限件数
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  // JSON 直列化時の replacer
  const replacer = opts.replacer ?? defaultReplacer;

  // 直列化キュー（read-modify-write の競合を防ぐため、書き込みを Promise チェインで順序保証）
  let chain: Promise<void> = Promise.resolve();

  // 実際の read-modify-write 処理（単一の write 呼び出しに対する純粋な作業）
  const performWrite = async (entry: LogEntry): Promise<void> => {
    // 既存値を取得（同期/非同期両対応）
    const raw = await opts.storage.getItem(key);
    // パース（壊れた値は空配列にする防衛コード）
    const existing = parseExisting(raw);
    // 末尾に新規エントリを追加
    existing.push(entry);
    // 上限を超える場合は古い順から切り捨て（splice 不使用、純粋に最新 N 件を保持）
    const kept = existing.length > maxEntries
      ? existing.slice(existing.length - maxEntries)
      : existing;
    // JSON 化して保存（replacer で Error 等を展開）
    await opts.storage.setItem(key, JSON.stringify(kept, replacer));
  };

  // Transport 契約を返す
  return {
    // 識別子
    name: "storage",
    // 1 件を追加して永続化（直前の write 完了後に開始することで競合を排除）
    write(entry) {
      // 直前の chain に続けて自身の write を繋ぐ。チェイン内の例外は catch して握りつぶし（次の write は走らせる）
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
