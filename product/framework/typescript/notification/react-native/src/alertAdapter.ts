import { Alert, type AlertButton, type AlertOptions } from "react-native";
import type {
  ConfirmNotification,
  DialogNotification,
  Notification,
  NotificationManager,
} from "@k1s0-ts-notification/core";

export interface AlertConfirmAdapterOptions {
  handleConfirm?: boolean;
  handleDialog?: boolean;
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

  const buildConfirmButtons = (notification: ConfirmNotification): AlertButton[] => {
    const cancelButton: AlertButton = {
      text: notification.cancelLabel ?? "キャンセル",
      style: "cancel",
      onPress: () => manager.resolveConfirm(notification.id, false),
    };
    const confirmButton: AlertButton = {
      text: notification.confirmLabel ?? "OK",
      style: notification.destructive ? "destructive" : "default",
      onPress: () => manager.resolveConfirm(notification.id, true),
    };
    return [cancelButton, confirmButton];
  };

  const buildDialogButtons = (notification: DialogNotification): AlertButton[] => {
    if (notification.actions === undefined || notification.actions.length === 0) {
      return [
        {
          text: "閉じる",
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

  const shownIds: Set<string> = new Set();

  const showIfNeeded = (notification: Notification): void => {
    if (notification.kind === "confirm" && handleConfirm && !shownIds.has(notification.id)) {
      shownIds.add(notification.id);
      const alertOptions: AlertOptions = {
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
    if (notification.kind === "dialog" && handleDialog && !shownIds.has(notification.id)) {
      shownIds.add(notification.id);
      const dismissible = notification.dismissible ?? true;
      const alertOptions: AlertOptions = {
        cancelable: dismissible,
      };
      if (dismissible) {
        alertOptions.onDismiss = () => manager.resolveDialog(notification.id, undefined);
      }
      Alert.alert(
        notification.title ?? "",
        notification.message,
        buildDialogButtons(notification),
        alertOptions,
      );
    }
  };

  const unsubscribe = manager.subscribe((event) => {
    if (event.type === "remove") {
      shownIds.delete(event.notification.id);
      return;
    }
    if (event.type !== "add") {
      return;
    }
    showIfNeeded(event.notification);
  });

  for (const notification of manager.getAll()) {
    showIfNeeded(notification);
  }

  return {
    dispose: () => {
      unsubscribe();
      shownIds.clear();
    },
  };
}
