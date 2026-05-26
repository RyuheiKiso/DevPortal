// React の hook と型を取り込み
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
// core から CameraManager 生成関数と関連型
import {
  createCameraManager,
  type CameraAdapter,
  type CameraManager,
  type CameraManagerConfig,
} from "@k1s0-ts-camera/core";
// Web 用既定 adapter
import { createWebAdapter } from "./webAdapter.js";
// Context
import { CameraContext } from "./context.js";

// Provider props（外部 manager または adapter / config を受け取る排他指定）
export type CameraProviderProps =
  | {
      // 外部生成済み manager（dispose も外部側の責務）
      manager: CameraManager;
      // 外部 manager 指定時は adapter / config を併用しない
      adapter?: undefined;
      config?: undefined;
      // 子要素
      children: ReactNode;
    }
  | {
      // 内部 manager 用の adapter（未指定なら createWebAdapter）
      adapter?: CameraAdapter;
      // 内部 manager の config
      config?: CameraManagerConfig;
      // 内部 manager 指定時は外部 manager を渡さない
      manager?: undefined;
      // 子要素
      children: ReactNode;
    };

// CameraProvider 本体
export function CameraProvider(props: CameraProviderProps): ReactElement {
  // 外部 manager（明示指定の優先）
  const externalManager = props.manager;
  // 内部 manager の保持先（マウント時に生成、unmount で dispose）
  const internalManagerRef = useRef<CameraManager | null>(null);

  // 外部 manager が無く、内部 manager 未生成なら生成する
  if (externalManager === undefined && internalManagerRef.current === null) {
    // adapter 未指定なら createWebAdapter を使う
    const adapter = props.adapter ?? createWebAdapter();
    internalManagerRef.current = createCameraManager(adapter, props.config);
  }

  // unmount で内部 manager を dispose
  useEffect(() => {
    return () => {
      // 内部 manager があれば dispose（adapter も内部で dispose される）
      const m = internalManagerRef.current;
      // null クリアは先に行い、二重 dispose を防ぐ
      internalManagerRef.current = null;
      if (m !== null) {
        // 非同期だが await はしない（unmount は同期）
        void m.dispose();
      }
    };
  }, []);

  // Context value は毎 render で ref から直接取得する
  // useMemo を使うと strict mode の double mount で再生成された manager がキャッシュに遅れて反映され
  // 古い dispose 済み manager を返してしまうリスクがあるため、メモ化を諦めて常に最新の ref を読む
  const value: CameraManager | null = externalManager ?? internalManagerRef.current;
  // Provider を返す
  return <CameraContext.Provider value={value}>{props.children}</CameraContext.Provider>;
}
