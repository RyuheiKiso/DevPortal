// React の hook
import { useCallback, useState } from "react";
// core から型
import type { FocusPoint } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";
// 能力情報
import { useCameraCapabilities } from "./capabilitiesHooks.js";

// useFocus の戻り値
export interface UseFocusResult {
  // フォーカス制御
  focus: (point?: FocusPoint) => Promise<void>;
  // 対応可否
  supported: boolean;
  // 直近エラー
  error: unknown;
}

// フォーカス制御 hook（react-native 版、API は react 版と同形）
export function useFocus(): UseFocusResult {
  const manager = useCamera();
  const { capabilities } = useCameraCapabilities();
  const [error, setError] = useState<unknown>(undefined);

  // フォーカス操作
  const focus = useCallback(
    async (point?: FocusPoint): Promise<void> => {
      setError(undefined);
      try {
        await manager.setFocus(point);
      } catch (err) {
        setError(err);
      }
    },
    [manager],
  );

  const supported = capabilities?.focus !== false && capabilities?.focus !== undefined;
  return { focus, supported, error };
}
