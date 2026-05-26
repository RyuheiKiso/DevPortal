// React の hook と型
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
// core
import {
  createOutboxManager,
  type OutboxManager,
  type OutboxManagerConfig,
} from "@k1s0-ts-outbox/core";
// Context
import { OutboxContext } from "./context.js";

// Provider の props (manager か config を排他指定)
export type OutboxProviderProps =
  | {
      manager: OutboxManager<unknown>;
      config?: undefined;
      children: ReactNode;
    }
  | {
      config: OutboxManagerConfig<unknown>;
      manager?: undefined;
      children: ReactNode;
    };

// React Native 版 Provider (react と同一構造)
export function OutboxProvider(props: OutboxProviderProps): ReactElement {
  // 外部 manager
  const externalManager = props.manager;
  // 内部 manager
  const internalManagerRef = useRef<OutboxManager<unknown> | null>(null);
  // 前回値の参照
  const prevExternalRef = useRef<OutboxManager<unknown> | undefined>(externalManager);

  // 外部 manager 未指定かつ内部 manager 未生成のとき初回だけ生成
  if (externalManager === undefined && internalManagerRef.current === null) {
    // JavaScript 経由で両方未指定が渡されるケースを runtime ガードで弾く
    if (props.config === undefined) {
      throw new Error("OutboxProvider requires either `manager` or `config` prop");
    }
    internalManagerRef.current = createOutboxManager(props.config);
  }

  // 外部 manager が後付けされた場合に内部を解放
  useEffect(() => {
    if (prevExternalRef.current === undefined && externalManager !== undefined) {
      // 非同期 dispose は意図的に fire-and-forget (内部エラーは manager 側 logger に集約)
      void internalManagerRef.current?.dispose();
      internalManagerRef.current = null;
    }
    prevExternalRef.current = externalManager;
  }, [externalManager]);

  // unmount で内部 manager を片付け
  useEffect(() => {
    return () => {
      // unmount cleanup は同期前提のため Promise は返せない → fire-and-forget
      void internalManagerRef.current?.dispose();
      internalManagerRef.current = null;
    };
  }, []);

  // Context 値 (外部優先)
  const value = externalManager ?? internalManagerRef.current;
  return <OutboxContext.Provider value={value}>{props.children}</OutboxContext.Provider>;
}
