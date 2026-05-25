// React の hook を取り込み
import { useCallback, useContext } from "react";
// core から型を取り込み
import type {
  ConfirmInput,
  DialogInput,
  DialogResult,
  NotificationManager,
  ToastInput,
} from "@k1s0-ts-notification/core";
// Context を取り込み
import { NotificationContext } from "./context.js";

// Provider 外で hook が呼ばれたときに throw する明示エラー
function ensureManager(manager: NotificationManager | null): NotificationManager {
  // null のとき（Provider 不在）は早期エラー
  if (manager === null) {
    throw new Error("useNotification must be called inside <NotificationProvider>");
  }
  // 取得済みの Manager を返す
  return manager;
}

// 主要 API を一括で取得する hook（toast / dialog / confirm / dismiss / dismissAll / resolveDialog / resolveConfirm / getAll）
export function useNotification(): NotificationManager {
  // Context から Manager を取り出す
  const manager = useContext(NotificationContext);
  // null チェック付きで返す
  return ensureManager(manager);
}

// toast 発行関数だけを取り出す糖衣 hook
export function useToast(): (input: ToastInput) => string {
  // 共通 hook 経由で Manager を取得
  const manager = useNotification();
  return useCallback((input: ToastInput) => manager.toast(input), [manager]);
}

// dialog 発行関数だけを取り出す糖衣 hook
export function useDialog(): (input: DialogInput) => Promise<DialogResult> {
  // 共通 hook 経由で Manager を取得
  const manager = useNotification();
  return useCallback((input: DialogInput) => manager.dialog(input), [manager]);
}

// confirm 発行関数だけを取り出す糖衣 hook
export function useConfirm(): (input: ConfirmInput) => Promise<boolean> {
  // 共通 hook 経由で Manager を取得
  const manager = useNotification();
  return useCallback((input: ConfirmInput) => manager.confirm(input), [manager]);
}

// dialog を reason 付きで解決する関数だけを取り出す糖衣 hook
// UI 側のボタン押下ハンドラに直接渡せる（例: `<button onClick={() => resolveDialog(id, "ok")}>`）
export function useDialogResolver(): (id: string, reason?: string) => void {
  // 共通 hook 経由で Manager を取得
  const manager = useNotification();
  return useCallback((id: string, reason?: string) => manager.resolveDialog(id, reason), [manager]);
}

// confirm を boolean で解決する関数だけを取り出す糖衣 hook
// UI 側のボタン押下ハンドラに直接渡せる（例: `<button onClick={() => resolveConfirm(id, true)}>`）
export function useConfirmResolver(): (id: string, value: boolean) => void {
  // 共通 hook 経由で Manager を取得
  const manager = useNotification();
  return useCallback((id: string, value: boolean) => manager.resolveConfirm(id, value), [manager]);
}
