// React の hook と型
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
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
// useState 初期化関数で manager を 1 度だけ生成し、useEffect は dispose のみを担当する
export function CameraProvider(props: CameraProviderProps): ReactElement {
  // 外部 manager（明示指定の優先）
  const externalManager = props.manager;
  // adapter / config を初期化関数のクロージャで読むため変数化
  const adapterProp = externalManager === undefined ? props.adapter : undefined;
  const configProp = externalManager === undefined ? props.config : undefined;
  // 内部 manager を useState 初期化関数で生成
  const [internalManager] = useState<CameraManager | null>(() => {
    // 外部 manager 指定時は内部生成しない
    if (externalManager !== undefined) {
      return null;
    }
    // React Native では adapter 必須型（プロップ型で保証されているが安全側にガード）
    if (adapterProp === undefined) {
      return null;
    }
    return createCameraManager(adapterProp, configProp);
  });

  // unmount で dispose
  useEffect(() => {
    return () => {
      if (internalManager !== null) {
        void internalManager.dispose();
      }
    };
  }, [internalManager]);

  // 外部 manager 優先、無ければ内部 manager
  const value: CameraManager | null = externalManager ?? internalManager;
  return <CameraContext.Provider value={value}>{props.children}</CameraContext.Provider>;
}
