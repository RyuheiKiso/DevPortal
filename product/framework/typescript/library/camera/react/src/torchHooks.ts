// React の hook
import { useCallback, useState } from "react";
// core から型
import type { TorchMode } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";
// 能力情報の購読 hook
import { useCameraCapabilities } from "./capabilitiesHooks.js";

// useTorch の戻り値
export interface UseTorchResult {
  // 現在の mode（楽観更新で保持）
  mode: TorchMode;
  // mode 切替
  set: (mode: TorchMode) => Promise<void>;
  // adapter がトーチ対応しているか（capabilities.torch === true）
  supported: boolean;
  // 直近エラー
  error: unknown;
}

// トーチ制御 hook
export function useTorch(): UseTorchResult {
  // manager
  const manager = useCamera();
  // 能力情報を購読
  const { capabilities } = useCameraCapabilities();
  // 楽観更新で保持する現在 mode（初期 off）
  const [mode, setMode] = useState<TorchMode>("off");
  // 直近エラー
  const [error, setError] = useState<unknown>(undefined);

  // setter
  const set = useCallback(
    async (next: TorchMode): Promise<void> => {
      setError(undefined);
      try {
        // adapter 呼び出し
        await manager.setTorch(next);
        // 成功時のみ state を更新
        setMode(next);
      } catch (err) {
        // 失敗時は state を変更せず error のみ
        setError(err);
      }
    },
    [manager],
  );

  // supported は capabilities.torch === true のときのみ
  const supported = capabilities?.torch === true;

  return { mode, set, supported, error };
}
