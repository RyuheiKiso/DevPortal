// React の hook
import { useCallback, useEffect, useRef, useState } from "react";
// core から型
import type { CapabilityRange } from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";
// 能力情報の購読 hook
import { useCameraCapabilities } from "./capabilitiesHooks.js";

// useZoom の戻り値
export interface UseZoomResult {
  // 現在のズーム倍率（楽観更新で保持。初期は 1、capabilities 取得後は range.min と同期）
  zoom: number;
  // 倍率設定（adapter が clamp する想定。range 外なら CameraControlError(OUT_OF_RANGE)）
  set: (zoom: number) => Promise<void>;
  // 取りうる range（capabilities.zoom が false / undefined のときは undefined）
  range: CapabilityRange | undefined;
  // adapter がズーム対応しているか
  supported: boolean;
  // 直近エラー
  error: unknown;
}

// ズーム制御 hook
export function useZoom(): UseZoomResult {
  // manager
  const manager = useCamera();
  // 能力情報を購読
  const { capabilities } = useCameraCapabilities();
  // 楽観更新で保持する現在 zoom（初期 fallback は 1.0）
  const [zoom, setZoomState] = useState<number>(1);
  // 直近エラー
  const [error, setError] = useState<unknown>(undefined);
  // ユーザが一度でも set() を呼んだら true（以降は range.min への自動同期を停止）
  const userSetRef = useRef<boolean>(false);

  // setter
  const set = useCallback(
    async (next: number): Promise<void> => {
      setError(undefined);
      try {
        // adapter 呼び出し
        await manager.setZoom(next);
        // 成功時のみ state を更新し、ユーザ操作済みフラグを立てる
        setZoomState(next);
        userSetRef.current = true;
      } catch (err) {
        // 失敗時は state を変更せず error のみ
        setError(err);
      }
    },
    [manager],
  );

  // range は capabilities.zoom がオブジェクトなら採用、false / undefined なら undefined
  const range = capabilities?.zoom !== false && capabilities?.zoom !== undefined ? capabilities.zoom : undefined;
  // supported は range が存在することと同義
  const supported = range !== undefined;

  // 直近の preview ハンドル ID（ハンドルが入れ替わったときだけ userSetRef をリセットする判定用）
  // useEffect 内で manager 切替時にリセットされるよう、effect 冒頭で初期化する
  const lastPreviewIdRef = useRef<string | undefined>(undefined);

  // preview-start のハンドル ID が前回と異なる場合だけ userSetRef をリセットする
  // 同一 preview の能力情報再取得などで preview-start が複数回飛んでも、ユーザの zoom 操作を温存する
  // manager 切替時には lastPreviewIdRef も合わせてリセットし、新 manager の最初の preview-start で
  // 不要なリセットが走らないようにする
  useEffect(() => {
    // manager が変わったタイミングで直近 ID をクリア（前 manager の状態を引き継がない）
    lastPreviewIdRef.current = undefined;
    // manager のイベント購読
    const unsub = manager.subscribe((event) => {
      // preview-start 以外は無視
      if (event.type !== "preview-start") {
        return;
      }
      // 初回 preview-start は ID を記録するだけ（reset しない）
      const prevId = lastPreviewIdRef.current;
      lastPreviewIdRef.current = event.handle.id;
      // 別 preview に切り替わったタイミングのみリセット。range の新値が分かっていれば
      // 直接 range.min に同期し、未取得なら 1 を fallback とする
      if (prevId !== undefined && prevId !== event.handle.id) {
        userSetRef.current = false;
        // 新 preview の range が既知なら min、未取得なら 1 にフォールバック（nullish なら 1）
        setZoomState(range?.min ?? 1);
      }
    });
    return unsub;
    // range を deps に入れると毎回 subscribe をやり直すため、最新値は closure で読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager]);

  // capabilities が更新されたら、ユーザが未操作なら zoom を range.min に同期する
  // ユーザ set 後は userSetRef が true のため何もしない（意志優先）
  // dep は range.min（primitive）に絞り、参照同一性の差異で再実行しないようにする
  useEffect(() => {
    if (range !== undefined && !userSetRef.current) {
      setZoomState(range.min);
    }
  }, [range?.min]);

  return { zoom, set, range, supported, error };
}
