// React hook
import { useCallback, useState } from "react";
// core 型
import type { PreviewConfig, PreviewHandle } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";

// 戻り値の型（React Native は HTMLVideoElement に依存しないため videoRef は型なしの mutable handle）
export interface UseCameraPreviewResult {
  // 開始
  start: (config?: PreviewConfig) => Promise<PreviewHandle | undefined>;
  // 停止
  stop: () => Promise<void>;
  // 現在のハンドル
  handle: PreviewHandle | undefined;
  // 起動中
  starting: boolean;
  // 直近エラー
  error: unknown;
}

// プレビュー hook（React Native 版）
export function useCameraPreview(initialConfig?: PreviewConfig): UseCameraPreviewResult {
  const manager = useCamera();
  const [handle, setHandle] = useState<PreviewHandle | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [starting, setStarting] = useState(false);

  const start = useCallback(
    async (config?: PreviewConfig): Promise<PreviewHandle | undefined> => {
      setStarting(true);
      setError(undefined);
      try {
        const merged: PreviewConfig = { ...initialConfig, ...config };
        const h = await manager.startPreview(merged);
        setHandle(h);
        return h;
      } catch (err) {
        setError(err);
        return undefined;
      } finally {
        setStarting(false);
      }
    },
    [manager, initialConfig],
  );

  const stop = useCallback(async (): Promise<void> => {
    try {
      await manager.stopPreview();
      setHandle(undefined);
    } catch (err) {
      setError(err);
    }
  }, [manager]);

  return { start, stop, handle, starting, error };
}
