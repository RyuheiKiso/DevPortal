// React の hook を取り込み
import { useRef, useSyncExternalStore } from "react";
// core の型を取り込み
import type { AppNotification, NotificationManager } from "@k1s0-ts-notification/core";
// 既存の hook を取り込み（manager 取得用）
import { useNotification } from "./hooks.js";

// useSyncExternalStore に渡す store の最小契約
interface NotificationStoreSnapshot {
  // 直近の通知一覧スナップショット（同一参照を返す保証付き）
  getSnapshot: () => readonly AppNotification[];
  // 変更通知用の購読関数（解除関数を返す）
  subscribe: (onStoreChange: () => void) => () => void;
}

// SSR / RSC 用の安定参照（凍結済み空配列）
// 毎回新規 [] を返すと useSyncExternalStore が「different snapshot on every call」エラーを出すため、
// モジュールスコープで 1 度だけ freeze し参照同一性を保証する
const EMPTY_SNAPSHOT: readonly AppNotification[] = Object.freeze<AppNotification[]>([]);

// SSR 環境では client 側 manager のキューを観測できないため、常に空配列の固定参照を返す
// （クライアントでハイドレート後は通常の getSnapshot 経路に切り替わるため mismatch にならない）
function getServerSnapshot(): readonly AppNotification[] {
  // 凍結済み空配列を返す
  return EMPTY_SNAPSHOT;
}

// manager から store を生成する内部ヘルパ
function createStoreSnapshot(manager: NotificationManager): NotificationStoreSnapshot {
  // 直近スナップショット（subscribe コールバックでのみ更新し、getSnapshot 連続呼び出しでも同一参照を返す）
  let snapshot = manager.getAll();
  // useSyncExternalStore 用の getSnapshot 実装
  const getSnapshot = (): readonly AppNotification[] => snapshot;
  // subscribe 実装：manager の subscribe を中継しつつ snapshot を更新
  const subscribe = (onStoreChange: () => void): (() => void) =>
    manager.subscribe(() => {
      // 通知発生時にだけ新スナップショットを採用（参照が変わるので React の再 render が走る）
      snapshot = manager.getAll();
      // React に store 変更を伝える
      onStoreChange();
    });
  // store オブジェクトを返す
  return { getSnapshot, subscribe };
}

// 現在の通知キューを state として購読する hook
// UI 側で <Toast /> や <Dialog /> を描画する際に使う
export function useNotificationStream(): readonly AppNotification[] {
  // Manager を取得（Provider 外なら throw）
  const manager = useNotification();
  // useMemo は React の cache 仕様上「捨てられる」可能性があり再生成で subscribe が再走るリスクがあるため、
  // useRef + 手動の manager 変更検出で安定保持する
  const storeRef = useRef<{ manager: NotificationManager; store: NotificationStoreSnapshot } | null>(
    null,
  );
  // 初回 or manager が差し替わった場合のみ store を生成し直す
  if (storeRef.current === null || storeRef.current.manager !== manager) {
    storeRef.current = { manager, store: createStoreSnapshot(manager) };
  }
  // 現在の store を取り出す
  const store = storeRef.current.store;
  // SSR では getServerSnapshot が EMPTY_SNAPSHOT の固定参照を返すため、hydration mismatch が起きない
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
  // 現在の配列を返す
  return items;
}

// SSR snapshot とその参照同一性をテストから検証するための内部 export
// 本番コードからは利用しない想定（接頭辞 __ で internal を示す）
export const __testing__ = {
  // SSR 専用の snapshot 取得関数（凍結空配列を返す）
  getServerSnapshot,
  // 固定参照の凍結空配列（参照同一性検証用）
  EMPTY_SNAPSHOT,
};
