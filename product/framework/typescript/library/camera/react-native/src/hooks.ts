// React hook
import { useCallback, useContext, useEffect, useState } from "react";
// core 型
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
  if (value === null) {
    throw new Error("useCamera must be called inside <CameraProvider>");
  }
  return value;
}

// 主要 manager hook
export function useCamera(): CameraManager {
  const value = useContext(CameraContext);
  return ensureManager(value);
}

// デバイス一覧 hook
export function useCameraDevices(): {
  // デバイス
  devices: readonly CameraDevice[];
  // リロード
  refresh: () => Promise<void>;
  // ロード状態
  loading: boolean;
  // エラー
  error: unknown;
} {
  const manager = useCamera();
  const [devices, setDevices] = useState<readonly CameraDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
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
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { devices, refresh, loading, error };
}

// 権限 hook
export function useCameraPermission(descriptor: PermissionDescriptor): {
  // 現在の状態
  status: PermissionStatus;
  // 要求
  request: () => Promise<PermissionStatus>;
  // 照会
  refresh: () => Promise<PermissionStatus>;
} {
  const manager = useCamera();
  const [status, setStatus] = useState<PermissionStatus>("unavailable");
  const refresh = useCallback(async (): Promise<PermissionStatus> => {
    const s = await manager.getPermission(descriptor);
    setStatus(s);
    return s;
  }, [manager, descriptor]);
  const request = useCallback(async (): Promise<PermissionStatus> => {
    const s = await manager.requestPermission(descriptor);
    setStatus(s);
    return s;
  }, [manager, descriptor]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, request, refresh };
}

// イベント購読 hook
export function useCameraEvents(listener: CameraListener): void {
  const manager = useCamera();
  useEffect(() => {
    const unsub = manager.subscribe((e: CameraEvent) => {
      listener(e);
    });
    return unsub;
  }, [manager, listener]);
}
