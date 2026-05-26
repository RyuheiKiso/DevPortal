// React の hook
import { useCallback, useState } from "react";
// core から型
import type { TorchMode } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";
// 能力情報
import { useCameraCapabilities } from "./capabilitiesHooks.js";

// useTorch の戻り値
export interface UseTorchResult {
  // 現在の mode（楽観更新）
  mode: TorchMode;
  // mode 切替
  set: (mode: TorchMode) => Promise<void>;
  // 対応可否
  supported: boolean;
  // 直近エラー
  error: unknown;
}

// トーチ制御 hook（react-native 版、API は react 版と同形）
export function useTorch(): UseTorchResult {
  const manager = useCamera();
  const { capabilities } = useCameraCapabilities();
  const [mode, setMode] = useState<TorchMode>("off");
  const [error, setError] = useState<unknown>(undefined);

  // setter
  const set = useCallback(
    async (next: TorchMode): Promise<void> => {
      setError(undefined);
      try {
        await manager.setTorch(next);
        setMode(next);
      } catch (err) {
        setError(err);
      }
    },
    [manager],
  );

  const supported = capabilities?.torch === true;
  return { mode, set, supported, error };
}
