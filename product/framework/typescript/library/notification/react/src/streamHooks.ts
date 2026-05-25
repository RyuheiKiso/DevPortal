// React の hook を取り込み
import { useMemo, useSyncExternalStore } from "react";
// core の型を取り込み
import type { Notification, NotificationManager } from "@k1s0-ts-notification/core";
// 既存の hook を取り込み（manager 取得用）
import { useNotification } from "./hooks.js";

interface NotificationStoreSnapshot {
  getSnapshot: () => readonly Notification[];
  subscribe: (onStoreChange: () => void) => () => void;
}

function createStoreSnapshot(manager: NotificationManager): NotificationStoreSnapshot {
  let snapshot = manager.getAll();
  const getSnapshot = (): readonly Notification[] => snapshot;
  const subscribe = (onStoreChange: () => void): (() => void) =>
    manager.subscribe(() => {
      snapshot = manager.getAll();
      onStoreChange();
    });
  return { getSnapshot, subscribe };
}

// 現在の通知キューを state として購読する hook
// UI 側で <Toast /> や <Dialog /> を描画する際に使う
export function useNotificationStream(): readonly Notification[] {
  // Manager を取得（Provider 外なら throw）
  const manager = useNotification();
  const store = useMemo(() => createStoreSnapshot(manager), [manager]);
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // 現在の配列を返す
  return items;
}
