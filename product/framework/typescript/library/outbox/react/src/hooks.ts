// React の hook
import { useCallback, useContext, useEffect, useState } from "react";
// core の型
import type {
  AppendInput,
  ListOptions,
  OutboxEntry,
  OutboxEvent,
  OutboxListener,
  OutboxManager,
  OutboxStatus,
} from "@k1s0-ts-outbox/core";
// Context
import { OutboxContext } from "./context.js";

// Provider 外で hook が呼ばれた場合に明示エラー
function ensureManager<T>(manager: OutboxManager<T> | null): OutboxManager<T> {
  // null のとき (Provider 不在) は早期エラー
  if (manager === null) {
    throw new Error("useOutbox must be called inside <OutboxProvider>");
  }
  // 取得済みの Manager を返す
  return manager;
}

// 主 API を一括で取得する hook
export function useOutbox<T = unknown>(): OutboxManager<T> {
  // Context から取り出す (内部は unknown だが、呼び出し側の総称型で読み替える)
  const manager = useContext(OutboxContext) as unknown as OutboxManager<T> | null;
  // null チェック付きで返す
  return ensureManager<T>(manager);
}

// 一覧を購読する hook (manager のイベントで自動再フェッチ)
export function useOutboxList<T = unknown>(opts?: ListOptions): readonly OutboxEntry<T>[] {
  // manager 取得
  const manager = useOutbox<T>();
  // 結果の state (初期は空)
  const [entries, setEntries] = useState<readonly OutboxEntry<T>[]>([]);
  // opts の参照変化で再購読
  useEffect(() => {
    // 初期フェッチ (unmount 後の setState は React の最新版では警告のみで影響なし)
    void manager.list(opts).then((next) => setEntries(next));
    // リスト構造を変えるイベント (追加・削除・状態遷移) のみ再フェッチ
    // failed / published 等の状態遷移もリスト表示に影響するため反映する
    // 大量エントリでの O(N) フェッチを抑えるため、scheduler 系・publishing は除外する
    const triggers: ReadonlySet<string> = new Set([
      // 新規追加 / 置換
      "appended",
      // 送信成功 (status=sent への遷移)
      "published",
      // 失敗 / リトライ (status=failed への遷移)
      "failed",
      // DLQ 移動 (本体 index から外れる)
      "movedToDlq",
      // DLQ 復帰 (DLQ → 本体 index)
      "restored",
      // 削除
      "removed",
    ]);
    // イベントごとに再フェッチ (リスト構造を変えるイベントだけ反応)
    const unsubscribe = manager.subscribe((event: OutboxEvent<T>) => {
      // triggers に含まれていれば再フェッチ
      if (triggers.has(event.type)) {
        void manager.list(opts).then((next) => setEntries(next));
      }
    });
    // cleanup で購読解除
    return () => {
      unsubscribe();
    };
    // opts は呼び出し側で安定化する (inline literal だと毎 render で再購読)
  }, [manager, opts]);
  // 現在の値を返す
  return entries;
}

// 単一エントリを購読する hook
export function useOutboxEntry<T = unknown>(id: string): OutboxEntry<T> | undefined {
  // manager
  const manager = useOutbox<T>();
  // 結果
  const [entry, setEntry] = useState<OutboxEntry<T> | undefined>(undefined);
  // id 変化で再購読
  useEffect(() => {
    // 初期取得
    void manager.get(id).then((e) => setEntry(e));
    // 該当 id のイベントだけ反応
    const unsubscribe = manager.subscribe((event: OutboxEvent<T>) => {
      // entry が無い (started/stopped/scheduled) か、id が違うイベントは無視
      if (event.entry === undefined || event.entry.id !== id) {
        return;
      }
      // 再取得
      void manager.get(id).then((e) => setEntry(e));
    });
    // cleanup で購読解除
    return () => {
      unsubscribe();
    };
  }, [manager, id]);
  // 現在の entry
  return entry;
}

// status だけを購読する派生 hook
export function useOutboxStatus<T = unknown>(id: string): OutboxStatus | undefined {
  // useOutboxEntry を流用
  const entry = useOutboxEntry<T>(id);
  // status のみ抽出
  return entry?.status;
}

// scheduler の start/stop と flush を取り出す hook
export function useOutboxControls(): {
  // scheduler 起動
  start: () => void;
  // scheduler 停止
  stop: () => void;
  // 即時 flush
  flush: () => Promise<void>;
} {
  // manager 取得
  const manager = useOutbox();
  // start
  const start = useCallback(() => manager.start(), [manager]);
  // stop
  const stop = useCallback(() => manager.stop(), [manager]);
  // flush
  const flush = useCallback(() => manager.flush(), [manager]);
  // 取得関数群
  return { start, stop, flush };
}

// append 関数だけを memoize で取り出す hook
export function useOutboxAppend<T = unknown>(): (input: AppendInput<T>) => Promise<OutboxEntry<T>> {
  // manager
  const manager = useOutbox<T>();
  // memoized callback
  return useCallback((input: AppendInput<T>) => manager.append(input), [manager]);
}

// イベントを購読する hook (listener を渡し、subscribe を自動的にライフサイクルに紐付ける)
export function useOutboxEvents<T = unknown>(listener: OutboxListener<T>): void {
  // manager
  const manager = useOutbox<T>();
  // listener 変化で再購読
  useEffect(() => {
    // 購読
    const unsubscribe = manager.subscribe(listener);
    // cleanup で解除
    return () => {
      unsubscribe();
    };
  }, [manager, listener]);
}
