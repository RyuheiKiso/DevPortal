// React の hook と型を取り込み
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
// core から Manager 生成関数・関連型・dev 判定ヘルパを取り込み
import {
  createNotificationManager,
  isDevelopment,
  type NotificationManager,
  type NotificationManagerConfig,
} from "@k1s0-ts-notification/core";
// Context を取り込み
import { NotificationContext } from "./context.js";

// NotificationManagerConfig 同士を意味的に等しいかで比較する shallow helper
// inline literal `config={{ ... }}` を再 render で渡されても primitive 値が同じなら警告を出さないため
// 関数フィールド（now / idFactory / timer）は ref 比較（値同等性は判定不能なので reference equality を採用）
function isConfigEqual(
  // 直前の config（初回マウント時に保持した値）
  prev: NotificationManagerConfig | undefined,
  // 今回 render の config
  next: NotificationManagerConfig | undefined,
): boolean {
  // 両方未指定なら等価
  if (prev === undefined && next === undefined) {
    return true;
  }
  // どちらか一方だけ undefined なら非等価
  if (prev === undefined || next === undefined) {
    return false;
  }
  // primitive フィールドは === で比較
  if (prev.defaultDuration !== next.defaultDuration) {
    return false;
  }
  if (prev.maxQueueSize !== next.maxQueueSize) {
    return false;
  }
  // 関数 / オブジェクトフィールドは ref 比較（値同等性の判定は不能）
  if (prev.now !== next.now) {
    return false;
  }
  if (prev.idFactory !== next.idFactory) {
    return false;
  }
  if (prev.timer !== next.timer) {
    return false;
  }
  // すべて一致
  return true;
}

// NotificationProvider に受け入れる props（manager か config の排他指定）
export type NotificationProviderProps =
  | {
      // 外部で生成した manager をそのまま流す
      manager: NotificationManager;
      // 外部 manager 指定時は config を併用しない
      config?: undefined;
      // 子要素
      children: ReactNode;
    }
  | {
      // 内部 manager を生成するための任意 config
      config?: NotificationManagerConfig;
      // 内部生成時は外部 manager を渡さない
      manager?: undefined;
      // 子要素
      children: ReactNode;
    };

// 通知 manager を提供する Provider 本体
export function NotificationProvider(props: NotificationProviderProps): ReactElement {
  // 外部 manager（指定があればそのまま流す）
  const externalManager = props.manager;
  // 内部 manager の保持先（初回マウントで作って unmount で dispose）
  const internalManagerRef = useRef<NotificationManager | null>(null);
  // 初回 config の参照を保持し、以降の値変化を検出する
  const initialConfigRef = useRef<NotificationManagerConfig | undefined>(props.config);
  // 同一インスタンス内で警告を 1 回だけに抑えるためのフラグ
  const warnedRef = useRef(false);
  // 前回 render の externalManager 値を保持（undefined → defined の遷移検出に使う）
  const prevExternalRef = useRef<NotificationManager | undefined>(externalManager);

  // 外部 manager 未指定かつ内部 manager 未生成のときに限り、初回だけ生成する
  if (externalManager === undefined && internalManagerRef.current === null) {
    internalManagerRef.current = createNotificationManager(props.config);
  }

  // 外部 manager 未指定で props.config の値が初回と意味的に異なる場合、dev 時に 1 回だけ警告する
  // manager は再生成しない（無限再生成の事故を避けるため、利用者には Provider 再マウントを促す）
  // inline literal `config={{ ... }}` でも primitive 値が同じなら警告を出さない
  if (
    externalManager === undefined &&
    !warnedRef.current &&
    !isConfigEqual(initialConfigRef.current, props.config) &&
    isDevelopment()
  ) {
    warnedRef.current = true;
    // eslint-disable-next-line no-console -- dev 時の利用者通知が目的
    console.warn(
      "[@k1s0-ts-notification/react] NotificationProvider の config プロップは初回マウント時のみ評価されます。" +
        "以降の変更を反映するには Provider を再マウントするか、外部 manager を `manager` プロップで渡してください。",
    );
  }

  // external manager が後付けで渡された遷移（undefined → defined）を検出して内部 manager を片付ける
  // 既存の unmount cleanup だけでは外部 manager が来た瞬間に内部 manager がリークするため、ここで明示的に dispose
  useEffect(() => {
    // 前回が未設定で今回が設定済みなら、internal を解放
    if (prevExternalRef.current === undefined && externalManager !== undefined) {
      internalManagerRef.current?.dispose();
      internalManagerRef.current = null;
    }
    // 次回比較のために値を更新
    prevExternalRef.current = externalManager;
  }, [externalManager]);

  // unmount 時に内部 manager を片付ける
  useEffect(() => {
    return () => {
      // 内部 manager がいれば dispose（タイマー停止と pending 解決を一括で行う）
      internalManagerRef.current?.dispose();
      // 解放後に再マウントで作り直せるよう null に戻す
      internalManagerRef.current = null;
    };
  }, []);

  // Context に流す値（外部優先、未指定なら内部）
  const value = externalManager ?? internalManagerRef.current;

  // Provider を返す
  return <NotificationContext.Provider value={value}>{props.children}</NotificationContext.Provider>;
}
