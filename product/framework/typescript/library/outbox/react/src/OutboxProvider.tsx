// React の hook と型
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
// core の Manager 生成と型
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
      // 外部生成済みの manager をそのまま流す
      manager: OutboxManager<unknown>;
      // 外部 manager 指定時は config を併用しない
      config?: undefined;
      // 子要素
      children: ReactNode;
    }
  | {
      // 内部生成のための任意 config (storage / publisher は必須なので呼び出し側で渡す)
      config: OutboxManagerConfig<unknown>;
      // 内部生成時は外部 manager を渡さない
      manager?: undefined;
      // 子要素
      children: ReactNode;
    };

// Outbox Manager を提供する Provider 本体
export function OutboxProvider(props: OutboxProviderProps): ReactElement {
  // 外部 manager (指定があればそのまま流す)
  const externalManager = props.manager;
  // 内部 manager の保持先 (初回マウントで作って unmount で dispose)
  const internalManagerRef = useRef<OutboxManager<unknown> | null>(null);
  // 前回 render の externalManager 値 (undefined → defined の遷移検出に使う)
  const prevExternalRef = useRef<OutboxManager<unknown> | undefined>(externalManager);

  // 外部 manager 未指定かつ内部 manager 未生成のときに限り、初回だけ生成する
  if (externalManager === undefined && internalManagerRef.current === null) {
    // JavaScript 経由で両方未指定が渡されるケースを実行時にも明示エラーで弾く
    // (TypeScript の排他ユニオンは config undefined を完全には弾けないため runtime ガード)
    if (props.config === undefined) {
      throw new Error("OutboxProvider requires either `manager` or `config` prop");
    }
    internalManagerRef.current = createOutboxManager(props.config);
  }

  // 外部 manager が後付けで渡された遷移 (undefined → defined) を検出して内部 manager を片付ける
  useEffect(() => {
    // 前回未設定 + 今回設定済みなら internal を解放
    if (prevExternalRef.current === undefined && externalManager !== undefined) {
      // 非同期 dispose は意図的に fire-and-forget する (cleanup を Promise 化しない)
      // dispose 内部のエラーは manager 側 logger に通知され、Provider 利用者には透過的にする方針
      void internalManagerRef.current?.dispose();
      internalManagerRef.current = null;
    }
    // 次回比較のために値を更新
    prevExternalRef.current = externalManager;
  }, [externalManager]);

  // unmount 時に内部 manager を片付ける
  useEffect(() => {
    // cleanup function
    return () => {
      // 内部 manager があれば dispose (in-flight publish を abort、scheduler 停止)
      // unmount 時の非同期 await を避けるため fire-and-forget で良い
      // (React の unmount cleanup は同期前提なので Promise は返せない)
      void internalManagerRef.current?.dispose();
      // 解放後に再マウントで作り直せるよう null に戻す
      internalManagerRef.current = null;
    };
  }, []);

  // Context に流す値 (外部優先、未指定なら内部)
  const value = externalManager ?? internalManagerRef.current;

  // Provider を返す
  return <OutboxContext.Provider value={value}>{props.children}</OutboxContext.Provider>;
}
