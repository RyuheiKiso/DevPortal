// React の hook
import { useCallback, useState } from "react";
// core から型
import type { FocusPoint } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";
// 能力情報の購読 hook
import { useCameraCapabilities } from "./capabilitiesHooks.js";

// useFocus の戻り値
export interface UseFocusResult {
  // フォーカス制御（point ありで tap、なしで連続 AF へ戻す）
  focus: (point?: FocusPoint) => Promise<void>;
  // adapter がタップフォーカス対応しているか
  supported: boolean;
  // 直近エラー
  error: unknown;
}

// フォーカス制御 hook
export function useFocus(): UseFocusResult {
  // manager
  const manager = useCamera();
  // 能力情報を購読
  const { capabilities } = useCameraCapabilities();
  // 直近エラー
  const [error, setError] = useState<unknown>(undefined);

  // フォーカス操作
  const focus = useCallback(
    async (point?: FocusPoint): Promise<void> => {
      setError(undefined);
      try {
        // adapter 呼び出し
        await manager.setFocus(point);
      } catch (err) {
        // 失敗時は error のみ保持
        setError(err);
      }
    },
    [manager],
  );

  // supported は capabilities.focus がオブジェクト（少なくとも tap か continuous いずれかが true）なら true
  const supported = capabilities?.focus !== false && capabilities?.focus !== undefined;

  return { focus, supported, error };
}
