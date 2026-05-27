import { Alert, type AlertButton, type AlertOptions } from "react-native";
import type {
  AppNotification,
  ConfirmNotification,
  DialogNotification,
  NotificationManager,
} from "@k1s0-ts-notification/core";

export interface AlertConfirmAdapterOptions {
  // confirm 通知を Alert で扱うか（既定 true）
  handleConfirm?: boolean;
  // dialog 通知を Alert で扱うか（既定 true）
  handleDialog?: boolean;
  /**
   * Alert ボタンに表示する既定ラベル。i18n 対応のためのフォールバック。
   * 優先順位: notification.{confirmLabel,cancelLabel} > options.labels.* > 既定文言（日本語）。
   * dialog の close ラベルは notification.actions が空のときの唯一のボタン文言として使われる。
   */
  labels?: {
    // confirm の確定ボタン既定ラベル（既定 "OK"）
    confirm?: string;
    // confirm のキャンセルボタン既定ラベル（既定 "キャンセル"）
    cancel?: string;
    // actions が空の dialog の閉じるボタン既定ラベル（既定 "閉じる"）
    close?: string;
  };
}

export interface AlertConfirmAdapterHandle {
  dispose: () => void;
}

export function createAlertConfirmAdapter(
  manager: NotificationManager,
  options: AlertConfirmAdapterOptions = {},
): AlertConfirmAdapterHandle {
  const handleConfirm = options.handleConfirm ?? true;
  const handleDialog = options.handleDialog ?? true;
  // ラベル既定値を一度だけ確定（per-call の labels?.* 参照ループを避ける）
  // 優先順位: notification.{confirmLabel,cancelLabel} > options.labels.* > 日本語既定
  const confirmFallbackLabel = options.labels?.confirm ?? "OK";
  const cancelFallbackLabel = options.labels?.cancel ?? "キャンセル";
  const closeFallbackLabel = options.labels?.close ?? "閉じる";

  // confirm 通知のボタンを構築
  const buildConfirmButtons = (notification: ConfirmNotification): AlertButton[] => {
    const cancelButton: AlertButton = {
      // 通知個別指定 > options.labels.cancel > "キャンセル"
      text: notification.cancelLabel ?? cancelFallbackLabel,
      style: "cancel",
      onPress: () => manager.resolveConfirm(notification.id, false),
    };
    const confirmButton: AlertButton = {
      // 通知個別指定 > options.labels.confirm > "OK"
      text: notification.confirmLabel ?? confirmFallbackLabel,
      style: notification.destructive ? "destructive" : "default",
      onPress: () => manager.resolveConfirm(notification.id, true),
    };
    return [cancelButton, confirmButton];
  };

  // dialog 通知のボタンを構築
  const buildDialogButtons = (notification: DialogNotification): AlertButton[] => {
    if (notification.actions === undefined || notification.actions.length === 0) {
      return [
        {
          // options.labels.close > "閉じる"
          text: closeFallbackLabel,
          onPress: () => manager.resolveDialog(notification.id, undefined),
        },
      ];
    }
    return notification.actions.map<AlertButton>((action) => ({
      text: action.label,
      style:
        action.intent === "destructive"
          ? "destructive"
          : action.intent === "primary"
            ? "default"
            : "cancel",
      onPress: () => manager.resolveDialog(notification.id, action.id),
    }));
  };

  // adapter が Alert で扱う通知の型（toast は対象外）
  type AlertableNotification = ConfirmNotification | DialogNotification;

  // 現在 Alert で表示中の通知 ID（null なら表示中なし）
  // React Native の Alert は同時 1 件しか表示できないため、複数を同時に Alert.alert すると
  // Android では後勝ちで前 Alert が消え、対応する Promise が永久未解決になるリスクがあった。
  // この current / waiting のペアで「同時表示は最大 1 件、次は前の解決後に出す」を保証する。
  let current: string | null = null;
  // 表示待ち通知の FIFO キュー（add 順 or install 時の getAll 順、kind は AlertableNotification に絞り込み済み）
  const waiting: AlertableNotification[] = [];

  // この adapter が扱う対象 kind か判定（handleConfirm / handleDialog で抑止可能）
  // type predicate で waiting / presentAlert 側の型を絞り込み、toast 以外への分岐を不要にする
  const isHandledKind = (
    notification: AppNotification,
  ): notification is AlertableNotification => {
    if (notification.kind === "confirm") return handleConfirm;
    if (notification.kind === "dialog") return handleDialog;
    return false;
  };

  // 通知を実際に Alert.alert で表示する内部関数（current にセット済み前提、enqueue で kind が confirm/dialog に絞り込み済み）
  const presentAlert = (notification: AlertableNotification): void => {
    if (notification.kind === "confirm") {
      const alertOptions: AlertOptions = {
        // ユーザー操作なしで Alert が消えた場合（Android OS 破棄など）も false で resolve させる
        onDismiss: () => manager.resolveConfirm(notification.id, false),
      };
      Alert.alert(
        notification.title ?? "",
        notification.message,
        buildConfirmButtons(notification),
        alertOptions,
      );
      return;
    }
    // ここから先は型 narrowing により notification は DialogNotification
    const dismissible = notification.dismissible ?? true;
    // dismissible に関わらず onDismiss は必ず設定する。
    // 旧実装は dismissible=false のとき onDismiss を未設定にしていたため、
    // Android の OS 破棄や RN reload で Alert が閉じられても manager.resolveDialog が呼ばれず、
    // 対応する Promise が永久未解決のまま残るリークがあった。
    // cancelable=false でも Android では稀に dismiss が走るため、defensive に登録する。
    const alertOptions: AlertOptions = {
      cancelable: dismissible,
      onDismiss: () => manager.resolveDialog(notification.id, undefined),
    };
    Alert.alert(
      notification.title ?? "",
      notification.message,
      buildDialogButtons(notification),
      alertOptions,
    );
  };

  // 表示中が無ければ待機キューから次の 1 件を取り出して表示する
  const showNext = (): void => {
    // 既に表示中があれば何もしない（解決後に再呼び出しされる）
    if (current !== null) return;
    // 待機キューから先頭を pop
    const next = waiting.shift();
    if (next === undefined) return;
    // current を立ててから Alert.alert を呼ぶ（remove イベントとの競合を避ける）
    current = next.id;
    presentAlert(next);
  };

  // 通知を待機キューに積み、必要なら即時表示
  const enqueue = (notification: AppNotification): void => {
    // 対象外 kind は無視（handleConfirm:false 等のときの dialog は queue に積まれない）
    if (!isHandledKind(notification)) return;
    // 既に current か waiting に同 ID が居る場合は重複を防ぐ（subscribe 経路と install 経路の競合保護）
    // 通常の利用パスでは到達しない defensive ガード（同 ID 重複 enqueue は idFactory がユニーク前提で発生しない）
    /* v8 ignore next */
    if (current === notification.id) return;
    /* v8 ignore next */
    if (waiting.some((n) => n.id === notification.id)) return;
    // 末尾に追加して次を表示
    waiting.push(notification);
    showNext();
  };

  // manager イベント購読：add で enqueue、remove で current クリア + 次を表示
  const unsubscribe = manager.subscribe((event) => {
    if (event.type === "remove") {
      // 待機中だった通知が remove されたら waiting からも除去（subscribe 経由で取り消されたケース）
      const waitingIndex = waiting.findIndex((n) => n.id === event.notification.id);
      if (waitingIndex >= 0) {
        waiting.splice(waitingIndex, 1);
      }
      // 表示中の通知が解決されたら current を空にし、次の待機通知を表示する
      if (current === event.notification.id) {
        current = null;
        showNext();
      }
      return;
    }
    if (event.type !== "add") {
      return;
    }
    enqueue(event.notification);
  });

  // install 時点で既に pending な通知も同じキュー経路に流す
  // （同期 for ループで Alert.alert を連打すると Android で後勝ちになるため、enqueue で逐次化）
  for (const notification of manager.getAll()) {
    enqueue(notification);
  }

  return {
    dispose: () => {
      unsubscribe();
      // 内部状態をクリア（再 install されても残らないように）
      waiting.length = 0;
      current = null;
    },
  };
}
