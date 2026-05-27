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

  // 直近の preview ハンドル ID（manager 切替時に effect 冒頭でリセット）
  const lastPreviewIdRef = useRef<string | undefined>(undefined);

  // preview-start のハンドル ID が前回と異なる場合だけ userSetRef をリセットする
  // manager 切替時には lastPreviewIdRef も合わせてリセットして新 manager の最初の preview-start で
  // 不要なリセットが走らないようにする
  useEffect(() => {
    // manager が変わったタイミングで直近 ID をクリア
    lastPreviewIdRef.current = undefined;
    // manager のイベント購読
    const unsub = manager.subscribe((event) => {
      // preview-start 以外は無視
      if (event.type !== "preview-start") {
        return;
      }
      // 初回 preview-start は ID を記録するだけ
      const prevId = lastPreviewIdRef.current;
      lastPreviewIdRef.current = event.handle.id;
      // 別 preview に切り替わった場合のみリセット。range が既知なら range.min を採用
      if (prevId !== undefined && prevId !== event.handle.id) {
        userSetRef.current = false;
        // 新 preview の range が既知なら min、未取得なら 1 fallback
        setZoomState(range?.min ?? 1);
      }
    });
    return unsub;
    // range は最新値を closure で読むため deps に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager]);

  // capabilities 取得時にユーザ未操作なら zoom を range.min に同期
  // dep は primitive の range.min に絞り、参照変化での再実行を避ける
  useEffect(() => {
    if (range !== undefined && !userSetRef.current) {
      setZoomState(range.min);
    }
  }, [range?.min]);

  return { zoom, set, range, supported, error };
}
