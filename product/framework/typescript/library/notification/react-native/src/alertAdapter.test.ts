import { describe, expect, it, vi } from "vitest";

const alertMock = vi.hoisted(() => ({
  calls: [] as Array<{
    title: string;
    message: string;
    buttons: ReadonlyArray<{
      text?: string;
      style?: string;
      onPress?: () => void;
    }>;
    options?: { cancelable?: boolean; onDismiss?: () => void };
  }>,
}));

vi.mock("react-native", () => ({
  Alert: {
    alert: (
      title: string,
      message: string,
      buttons: ReadonlyArray<{ text?: string; style?: string; onPress?: () => void }>,
      options?: { cancelable?: boolean; onDismiss?: () => void },
    ): void => {
      alertMock.calls.push({ title, message, buttons, options });
    },
  },
}));

import { createNotificationManager } from "@k1s0-ts-notification/core";
import { createAlertConfirmAdapter } from "./alertAdapter.js";

function setup() {
  alertMock.calls.length = 0;
  const manager = createNotificationManager();
  const handle = createAlertConfirmAdapter(manager);
  return { manager, handle };
}

describe("createAlertConfirmAdapter", () => {
  it("shows confirm notifications and resolves true from the confirm button", async () => {
    const { manager } = setup();
    const result = manager.confirm({ message: "delete?", confirmLabel: "Delete", cancelLabel: "Keep" });

    expect(alertMock.calls).toHaveLength(1);
    const call = alertMock.calls[0]!;
    expect(call.message).toBe("delete?");
    expect(call.buttons).toHaveLength(2);
    expect(call.buttons[0]?.text).toBe("Keep");
    expect(call.buttons[1]?.text).toBe("Delete");

    call.buttons[1]?.onPress?.();
    await expect(result).resolves.toBe(true);
  });

  it("uses destructive style for destructive confirms", () => {
    const { manager } = setup();
    void manager.confirm({ message: "delete", destructive: true });
    expect(alertMock.calls[0]?.buttons[1]?.style).toBe("destructive");
  });

  it("resolves false from the confirm cancel button", async () => {
    const { manager } = setup();
    const result = manager.confirm({ message: "delete?" });
    alertMock.calls[0]?.buttons[0]?.onPress?.();
    await expect(result).resolves.toBe(false);
  });

  it("resolves false from confirm onDismiss", async () => {
    const { manager } = setup();
    const result = manager.confirm({ message: "delete?" });
    alertMock.calls[0]?.options?.onDismiss?.();
    await expect(result).resolves.toBe(false);
  });

  it("shows a default close button for dialogs without actions", async () => {
    const { manager } = setup();
    const result = manager.dialog({ message: "info" });
    const call = alertMock.calls[0]!;
    expect(call.buttons).toHaveLength(1);
    expect(call.buttons[0]?.text).toBe("閉じる");

    call.buttons[0]?.onPress?.();
    await expect(result).resolves.toEqual({ dismissed: true, reason: undefined });
  });

  it("maps dialog actions to Alert buttons", async () => {
    const { manager } = setup();
    const result = manager.dialog({
      message: "choose",
      actions: [
        { id: "ok", label: "OK", intent: "primary" },
        { id: "delete", label: "Delete", intent: "destructive" },
        { id: "later", label: "Later" },
      ],
    });
    const call = alertMock.calls[0]!;
    expect(call.buttons.map((b) => b.text)).toEqual(["OK", "Delete", "Later"]);
    expect(call.buttons[0]?.style).toBe("default");
    expect(call.buttons[1]?.style).toBe("destructive");
    expect(call.buttons[2]?.style).toBe("cancel");

    call.buttons[1]?.onPress?.();
    await expect(result).resolves.toEqual({ dismissed: true, reason: "delete" });
  });

  it("resolves dialogs from onDismiss", async () => {
    const { manager } = setup();
    const result = manager.dialog({ message: "info" });
    expect(alertMock.calls[0]?.options?.cancelable).toBe(true);
    alertMock.calls[0]?.options?.onDismiss?.();
    await expect(result).resolves.toEqual({ dismissed: true, reason: undefined });
  });

  // dismissible=false でも onDismiss は登録される (Android OS 破棄や RN reload による
  // Alert 強制終了で Promise が永久未解決になるのを防ぐため)
  it("passes non-dismissible dialogs as non-cancelable but still registers onDismiss", async () => {
    const { manager } = setup();
    const result = manager.dialog({ message: "locked", dismissible: false });
    // cancelable は false (UI 上のスワイプ/タップ dismiss を不許可)
    expect(alertMock.calls[0]?.options?.cancelable).toBe(false);
    // onDismiss はリーク防止のため常に登録されている
    expect(alertMock.calls[0]?.options?.onDismiss).toBeDefined();
    // onDismiss を呼べば Promise が resolve(dismissed:true) される
    alertMock.calls[0]?.options?.onDismiss?.();
    await expect(result).resolves.toEqual({ dismissed: true, reason: undefined });
  });

  it("shows already pending confirm notifications when the adapter is installed", async () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    const result = manager.confirm({ message: "already pending" });

    createAlertConfirmAdapter(manager);

    expect(alertMock.calls).toHaveLength(1);
    expect(alertMock.calls[0]?.message).toBe("already pending");
    alertMock.calls[0]?.buttons[1]?.onPress?.();
    await expect(result).resolves.toBe(true);
  });

  it("does not show the same notification id twice while pending", () => {
    const { manager } = setup();
    void manager.confirm({ message: "x" });
    expect(alertMock.calls).toHaveLength(1);
  });

  it("stops showing new dialogs after dispose", () => {
    const { manager, handle } = setup();
    handle.dispose();
    void manager.confirm({ message: "later" });
    expect(alertMock.calls).toHaveLength(0);
  });

  it("can ignore confirm notifications", () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    createAlertConfirmAdapter(manager, { handleConfirm: false });
    void manager.confirm({ message: "x" });
    expect(alertMock.calls).toHaveLength(0);
  });

  it("can ignore dialog notifications", () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    createAlertConfirmAdapter(manager, { handleDialog: false });
    void manager.dialog({ message: "x" });
    expect(alertMock.calls).toHaveLength(0);
  });

  it("ignores toast add events", () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    createAlertConfirmAdapter(manager);
    manager.toast({ message: "noisy" });
    expect(alertMock.calls).toHaveLength(0);
  });

  it("ignores toast update events", () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    createAlertConfirmAdapter(manager);
    manager.toast({ message: "v1", dedupeKey: "k" });
    manager.toast({ message: "v2", dedupeKey: "k" });
    expect(alertMock.calls).toHaveLength(0);
  });

  it("allows the same id to be shown again after the first notification is removed", async () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager({ idFactory: () => "fixed-id" });
    createAlertConfirmAdapter(manager);

    const firstResult = manager.confirm({ message: "first" });
    expect(alertMock.calls).toHaveLength(1);
    alertMock.calls[0]?.buttons[1]?.onPress?.();
    await expect(firstResult).resolves.toBe(true);

    void manager.confirm({ message: "second" });
    expect(alertMock.calls).toHaveLength(2);
    expect(alertMock.calls[1]?.message).toBe("second");
  });

  it("does not show notifications after manager disposal", () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    createAlertConfirmAdapter(manager);

    void manager.confirm({ message: "x" });
    expect(alertMock.calls).toHaveLength(1);
    manager.dispose();
    void manager.confirm({ message: "after-dispose" });
    expect(alertMock.calls).toHaveLength(1);
  });
});
