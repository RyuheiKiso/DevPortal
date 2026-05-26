// React の hook
import { useCallback, useEffect, useRef, useState } from "react";
// core から型
import type { PreviewConfig, PreviewHandle } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";

// プレビュー hook の戻り値
export interface UseCameraPreviewResult {
  // <video> に attach するための ref
  videoRef: React.RefObject<HTMLVideoElement | null>;
  // 開始
  start: (config?: PreviewConfig) => Promise<PreviewHandle | undefined>;
  // 停止
  stop: () => Promise<void>;
  // 直近エラー
  error: unknown;
  // 現在のハンドル（停止中は undefined）
  handle: PreviewHandle | undefined;
  // 開始中フラグ
  starting: boolean;
}

// プレビューを <video> に attach するための hook
// autoStart=true なら videoRef が set されたタイミングで自動 start
export function useCameraPreview(
  initialConfig?: PreviewConfig,
  options: { autoStart?: boolean } = {},
): UseCameraPreviewResult {
  // manager
  const manager = useCamera();
  // videoRef
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // state
  const [handle, setHandle] = useState<PreviewHandle | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [starting, setStarting] = useState(false);

  // start
  const start = useCallback(
    async (config?: PreviewConfig): Promise<PreviewHandle | undefined> => {
      setStarting(true);
      setError(undefined);
      try {
        // target に videoRef.current を渡す（null の場合は省略）
        const merged: PreviewConfig = {
          ...initialConfig,
          ...config,
          target: (config?.target ?? initialConfig?.target ?? videoRef.current) ?? undefined,
        };
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

  // stop
  const stop = useCallback(async (): Promise<void> => {
    try {
      await manager.stopPreview();
      setHandle(undefined);
    } catch (err) {
      setError(err);
    }
  }, [manager]);

  // autoStart オプション：ref が attach され次第 start
  useEffect(() => {
    // autoStart 無効なら何もしない
    if (options.autoStart !== true) {
      return;
    }
    // ref が空なら何もしない
    if (videoRef.current === null) {
      return;
    }
    void start();
    // unmount で停止
    return () => {
      void manager.stopPreview();
    };
    // 意図的に start を deps に含めない（コールバック自体は安定で、autoStart の意図は初回 attach のみ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.autoStart]);

  return { videoRef, start, stop, error, handle, starting };
}
