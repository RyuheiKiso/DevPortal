// React の hook
import { useCallback, useEffect, useRef, useState } from "react";
// core から型
import type { CapabilityRange } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";
// 能力情報
import { useCameraCapabilities } from "./capabilitiesHooks.js";

// useZoom の戻り値
export interface UseZoomResult {
  // 現在のズーム倍率（楽観更新、初期 fallback は 1、capabilities 取得後は range.min と同期）
  zoom: number;
  // 倍率設定
  set: (zoom: number) => Promise<void>;
  // 取りうる range（未対応時は undefined）
  range: CapabilityRange | undefined;
  // 対応可否
  supported: boolean;
  // 直近エラー
  error: unknown;
}

// ズーム制御 hook（react-native 版、API は react 版と同形）
export function useZoom(): UseZoomResult {
  const manager = useCamera();
  const { capabilities } = useCameraCapabilities();
  const [zoom, setZoomState] = useState<number>(1);
  const [error, setError] = useState<unknown>(undefined);
  // ユーザが一度でも set() を呼んだら true（range.min への自動同期を停止）
  const userSetRef = useRef<boolean>(false);

  // setter
  const set = useCallback(
    async (next: number): Promise<void> => {
      setError(undefined);
      try {
        await manager.setZoom(next);
        // 成功時のみ state を更新し、ユーザ操作済みフラグを立てる
        setZoomState(next);
        userSetRef.current = true;
      } catch (err) {
        setError(err);
      }
    },
    [manager],
  );

  const range = capabilities?.zoom !== false && capabilities?.zoom !== undefined ? capabilities.zoom : undefined;
  const supported = range !== undefined;

  // capabilities 取得時にユーザ未操作なら zoom を range.min に同期
  useEffect(() => {
    if (range !== undefined && !userSetRef.current) {
      setZoomState(range.min);
    }
  }, [range]);

  return { zoom, set, range, supported, error };
}
