// React の hook
import { useCallback, useEffect, useState } from "react";
// core から型
import type { CameraCapabilities } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";

// useCameraCapabilities の戻り値
export interface UseCameraCapabilitiesResult {
  // 直近取得の capabilities（未取得は undefined）
  capabilities: CameraCapabilities | undefined;
  // 再取得（手動 refresh 用）
  refresh: () => Promise<CameraCapabilities | undefined>;
  // ロード中フラグ
  loading: boolean;
  // 直近エラー
  error: unknown;
}

// CameraCapabilities を取得・購読する hook
// preview-start イベントを購読し、プレビュー開始のたびに自動再取得する
export function useCameraCapabilities(): UseCameraCapabilitiesResult {
  // manager
  const manager = useCamera();
  // state
  const [capabilities, setCapabilities] = useState<CameraCapabilities | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  // 取得関数
  const refresh = useCallback(async (): Promise<CameraCapabilities | undefined> => {
    // ロード開始
    setLoading(true);
    setError(undefined);
    try {
      // adapter 経由で能力を取得
      const caps = await manager.getCapabilities();
      setCapabilities(caps);
      return caps;
    } catch (err) {
      // 失敗時は error を保持し undefined を返す
      setError(err);
      return undefined;
    } finally {
      // ロード終了
      setLoading(false);
    }
  }, [manager]);

  // preview-start イベントで自動再取得
  useEffect(() => {
    const unsub = manager.subscribe((event) => {
      if (event.type === "preview-start") {
        void refresh();
      }
    });
    return unsub;
  }, [manager, refresh]);

  return { capabilities, refresh, loading, error };
}
