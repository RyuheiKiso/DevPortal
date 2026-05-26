// React の hook を取り込み
import { useCallback, useContext, useEffect, useState } from "react";
// core から型を取り込み
import type {
  CameraDevice,
  CameraEvent,
  CameraListener,
  CameraManager,
  PermissionDescriptor,
  PermissionStatus,
} from "@k1s0-ts-camera/core";
// Context
import { CameraContext } from "./context.js";

// Provider 不在時のエラー
function ensureManager(value: CameraManager | null): CameraManager {
  // null は Provider 不在
  if (value === null) {
    throw new Error("useCamera must be called inside <CameraProvider>");
  }
  return value;
}

// 主要 manager を取り出す hook
export function useCamera(): CameraManager {
  // Context から値を取り出す
  const value = useContext(CameraContext);
  // null チェックして返す
  return ensureManager(value);
}

// デバイス一覧 hook
export function useCameraDevices(): {
  // 現在のデバイス一覧
  devices: readonly CameraDevice[];
  // 再列挙（リフレッシュ）
  refresh: () => Promise<void>;
  // ロード中フラグ
  loading: boolean;
  // 直近エラー
  error: unknown;
} {
  // manager
  const manager = useCamera();
  // state
  const [devices, setDevices] = useState<readonly CameraDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  // 列挙関数
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const list = await manager.listDevices();
      setDevices(list);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [manager]);
  // 初回マウント時に列挙
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { devices, refresh, loading, error };
}

// 権限状態 hook
export function useCameraPermission(descriptor: PermissionDescriptor): {
  // 現在の status（未取得は unavailable で初期化）
  status: PermissionStatus;
  // 権限要求
  request: () => Promise<PermissionStatus>;
  // 再照会
  refresh: () => Promise<PermissionStatus>;
} {
  const manager = useCamera();
  // 初期は unavailable
  const [status, setStatus] = useState<PermissionStatus>("unavailable");
  // 照会
  const refresh = useCallback(async (): Promise<PermissionStatus> => {
    const s = await manager.getPermission(descriptor);
    setStatus(s);
    return s;
  }, [manager, descriptor]);
  // 要求
  const request = useCallback(async (): Promise<PermissionStatus> => {
    const s = await manager.requestPermission(descriptor);
    setStatus(s);
    return s;
  }, [manager, descriptor]);
  // 初回マウントで照会
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, request, refresh };
}

// 任意イベントを listener で受け取る hook
export function useCameraEvents(listener: CameraListener): void {
  const manager = useCamera();
  // listener が変わる度に subscribe をやり直す
  useEffect(() => {
    const unsub = manager.subscribe((e: CameraEvent) => {
      listener(e);
    });
    return unsub;
  }, [manager, listener]);
}
