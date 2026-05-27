// React の hook と型を取り込み
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
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
// 初回 render で即 manager を利用できるよう useState 初期化関数で生成し、
// useEffect では dispose だけを担当する（render 中の ref 代入を避け Concurrent と整合）
export function CameraProvider(props: CameraProviderProps): ReactElement {
  // 外部 manager（明示指定の優先）
  const externalManager = props.manager;
  // adapter / config を初期化関数のクロージャで読むため変数化
  const adapterProp = externalManager === undefined ? props.adapter : undefined;
  const configProp = externalManager === undefined ? props.config : undefined;
  // 内部 manager を useState 初期化関数で 1 度だけ生成する（StrictMode の double-invoke は dev only）
  const [internalManager] = useState<CameraManager | null>(() => {
    // 外部 manager 指定時は内部生成しない
    if (externalManager !== undefined) {
      return null;
    }
    // adapter 未指定なら createWebAdapter を使う
    const adapter = adapterProp ?? createWebAdapter();
    return createCameraManager(adapter, configProp);
  });

  // unmount で内部 manager を dispose（外部 manager は呼出側責務）
  useEffect(() => {
    return () => {
      if (internalManager !== null) {
        void internalManager.dispose();
      }
    };
  }, [internalManager]);

  // Context value は外部 manager 優先、無ければ内部 manager
  const value: CameraManager | null = externalManager ?? internalManager;
  // Provider を返す
  return <CameraContext.Provider value={value}>{props.children}</CameraContext.Provider>;
}
