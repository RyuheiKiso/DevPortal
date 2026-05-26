// React の hook と型
import { useEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";
// core
import {
  createCameraManager,
  type CameraAdapter,
  type CameraManager,
  type CameraManagerConfig,
} from "@k1s0-ts-camera/core";
// Context
import { CameraContext } from "./context.js";

// React Native では adapter は明示注入が必須（Web のような既定 adapter が存在しないため）
export type CameraProviderProps =
  | {
      // 外部生成済み manager
      manager: CameraManager;
      // 排他指定
      adapter?: undefined;
      config?: undefined;
      children: ReactNode;
    }
  | {
      // 必須 adapter
      adapter: CameraAdapter;
      // 任意 config
      config?: CameraManagerConfig;
      manager?: undefined;
      children: ReactNode;
    };

// React Native 用 CameraProvider
export function CameraProvider(props: CameraProviderProps): ReactElement {
  // 外部 manager
  const externalManager = props.manager;
  // 内部 manager の保持先
  const internalManagerRef = useRef<CameraManager | null>(null);

  // 内部 manager 未生成かつ外部 manager 無しなら生成
  if (externalManager === undefined && internalManagerRef.current === null) {
    // adapter は必須型のため確実に存在する
    internalManagerRef.current = createCameraManager(props.adapter, props.config);
  }

  // unmount で dispose
  useEffect(() => {
    return () => {
      const m = internalManagerRef.current;
      internalManagerRef.current = null;
      if (m !== null) {
        void m.dispose();
      }
    };
  }, []);

  // Context value
  const value = useMemo<CameraManager | null>(
    () => externalManager ?? internalManagerRef.current,
    [externalManager],
  );

  return <CameraContext.Provider value={value}>{props.children}</CameraContext.Provider>;
}
