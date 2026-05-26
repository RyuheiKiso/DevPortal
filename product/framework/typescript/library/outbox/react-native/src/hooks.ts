// react 版と同等。React Native でもそのまま動作する
import { useCallback, useContext, useEffect, useState } from "react";
import type {
  AppendInput,
  ListOptions,
  OutboxEntry,
  OutboxEvent,
  OutboxListener,
  OutboxManager,
  OutboxStatus,
} from "@k1s0-ts-outbox/core";
import { OutboxContext } from "./context.js";

// Provider 外で hook が呼ばれた場合にエラー
function ensureManager<T>(manager: OutboxManager<T> | null): OutboxManager<T> {
  // null なら明示 throw
  if (manager === null) {
    throw new Error("useOutbox must be called inside <OutboxProvider>");
  }
  return manager;
}

// 主 API
export function useOutbox<T = unknown>(): OutboxManager<T> {
  // Context 取得
  const manager = useContext(OutboxContext) as unknown as OutboxManager<T> | null;
  return ensureManager<T>(manager);
}

// list 購読
export function useOutboxList<T = unknown>(opts?: ListOptions): readonly OutboxEntry<T>[] {
  // manager
  const manager = useOutbox<T>();
  // state
  const [entries, setEntries] = useState<readonly OutboxEntry<T>[]>([]);
  // opts 変化で再購読
  useEffect(() => {
    // 初期取得
    void manager.list(opts).then((next) => setEntries(next));
    // リスト構造を変える主要イベントのみ再フェッチ (大量エントリでの再フェッチ嵐を防ぐ)
    const triggers: ReadonlySet<string> = new Set([
      // 新規追加 / 置換 / 失敗 / 成功 / DLQ 移動 / DLQ 復帰 / 削除
      "appended", "published", "failed", "movedToDlq", "restored", "removed",
    ]);
    // 購読
    const unsubscribe = manager.subscribe((event: OutboxEvent<T>) => {
      if (triggers.has(event.type)) {
        void manager.list(opts).then((next) => setEntries(next));
      }
    });
    // cleanup
    return () => { unsubscribe(); };
  }, [manager, opts]);
  return entries;
}

// 単一エントリ購読
export function useOutboxEntry<T = unknown>(id: string): OutboxEntry<T> | undefined {
  // manager
  const manager = useOutbox<T>();
  // state
  const [entry, setEntry] = useState<OutboxEntry<T> | undefined>(undefined);
  // 購読
  useEffect(() => {
    void manager.get(id).then((e) => setEntry(e));
    const unsubscribe = manager.subscribe((event: OutboxEvent<T>) => {
      if (event.entry === undefined || event.entry.id !== id) {
        return;
      }
      void manager.get(id).then((e) => setEntry(e));
    });
    return () => { unsubscribe(); };
  }, [manager, id]);
  return entry;
}

// status の派生
export function useOutboxStatus<T = unknown>(id: string): OutboxStatus | undefined {
  // useOutboxEntry を流用
  const entry = useOutboxEntry<T>(id);
  return entry?.status;
}

// scheduler 制御
export function useOutboxControls(): {
  start: () => void;
  stop: () => void;
  flush: () => Promise<void>;
} {
  // manager
  const manager = useOutbox();
  // memoized callbacks
  const start = useCallback(() => manager.start(), [manager]);
  const stop = useCallback(() => manager.stop(), [manager]);
  const flush = useCallback(() => manager.flush(), [manager]);
  return { start, stop, flush };
}

// append
export function useOutboxAppend<T = unknown>(): (input: AppendInput<T>) => Promise<OutboxEntry<T>> {
  // manager
  const manager = useOutbox<T>();
  return useCallback((input: AppendInput<T>) => manager.append(input), [manager]);
}

// events 購読
export function useOutboxEvents<T = unknown>(listener: OutboxListener<T>): void {
  // manager
  const manager = useOutbox<T>();
  useEffect(() => {
    const unsubscribe = manager.subscribe(listener);
    return () => { unsubscribe(); };
  }, [manager, listener]);
}
