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

  // i18n: options.labels.confirm が confirm 既定ラベルとして使われる
  it("uses options.labels.confirm as the default confirm button label", () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    createAlertConfirmAdapter(manager, { labels: { confirm: "Yes" } });
    // confirmLabel 未指定で発行 → labels.confirm がフォールバックに使われる
    void manager.confirm({ message: "?" });
    expect(alertMock.calls[0]?.buttons[1]?.text).toBe("Yes");
  });

  // i18n: options.labels.cancel が cancel 既定ラベルとして使われる
  it("uses options.labels.cancel as the default cancel button label", () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    createAlertConfirmAdapter(manager, { labels: { cancel: "No" } });
    // cancelLabel 未指定 → labels.cancel フォールバック
    void manager.confirm({ message: "?" });
    expect(alertMock.calls[0]?.buttons[0]?.text).toBe("No");
  });

  // i18n: options.labels.close が dialog の close 既定ラベルとして使われる
  it("uses options.labels.close as the default close button label for action-less dialogs", () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    createAlertConfirmAdapter(manager, { labels: { close: "Dismiss" } });
    // actions なし dialog → labels.close が close ボタン文言になる
    void manager.dialog({ message: "info" });
    expect(alertMock.calls[0]?.buttons).toHaveLength(1);
    expect(alertMock.calls[0]?.buttons[0]?.text).toBe("Dismiss");
  });

  // i18n: notification.confirmLabel は options.labels.confirm より優先される
  it("per-notification confirmLabel/cancelLabel wins over options.labels", () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    createAlertConfirmAdapter(manager, { labels: { confirm: "Yes", cancel: "No" } });
    // 通知個別の confirmLabel/cancelLabel を指定
    void manager.confirm({ message: "?", confirmLabel: "Override-OK", cancelLabel: "Override-NG" });
    expect(alertMock.calls[0]?.buttons[0]?.text).toBe("Override-NG");
    expect(alertMock.calls[0]?.buttons[1]?.text).toBe("Override-OK");
  });

  // キューイング: install 時に複数 pending があっても、1 件ずつ順次表示される
  it("displays multiple pending notifications one at a time when installed", async () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    // install 前に 3 件 pending を作る
    const a = manager.confirm({ message: "A" });
    const b = manager.confirm({ message: "B" });
    const c = manager.confirm({ message: "C" });
    // install 時点では 1 件目のみ表示される
    createAlertConfirmAdapter(manager);
    expect(alertMock.calls).toHaveLength(1);
    expect(alertMock.calls[0]?.message).toBe("A");
    // A を resolve すると 2 件目が表示される
    alertMock.calls[0]?.buttons[1]?.onPress?.();
    await expect(a).resolves.toBe(true);
    expect(alertMock.calls).toHaveLength(2);
    expect(alertMock.calls[1]?.message).toBe("B");
    // B を resolve すると 3 件目が表示される
    alertMock.calls[1]?.buttons[0]?.onPress?.();
    await expect(b).resolves.toBe(false);
    expect(alertMock.calls).toHaveLength(3);
    expect(alertMock.calls[2]?.message).toBe("C");
    // C も resolve できる
    alertMock.calls[2]?.buttons[1]?.onPress?.();
    await expect(c).resolves.toBe(true);
  });

  // キューイング: install 後の連続 add も順次表示される
  it("queues notifications added after install and shows them one at a time", async () => {
    const { manager } = setup();
    const a = manager.confirm({ message: "A" });
    const b = manager.confirm({ message: "B" });
    // A 表示中は B はまだ Alert.alert に到達していない
    expect(alertMock.calls).toHaveLength(1);
    expect(alertMock.calls[0]?.message).toBe("A");
    // A を解決すると B が表示される
    alertMock.calls[0]?.buttons[1]?.onPress?.();
    await expect(a).resolves.toBe(true);
    expect(alertMock.calls).toHaveLength(2);
    expect(alertMock.calls[1]?.message).toBe("B");
    alertMock.calls[1]?.buttons[1]?.onPress?.();
    await expect(b).resolves.toBe(true);
  });

  // キューイング: dialog と confirm が混在しても add 順に表示される
  it("preserves FIFO order across dialog and confirm kinds", async () => {
    const { manager } = setup();
    const c = manager.confirm({ message: "C-first" });
    const d = manager.dialog({ message: "D-second" });
    // 最初は confirm のみ表示中
    expect(alertMock.calls).toHaveLength(1);
    expect(alertMock.calls[0]?.message).toBe("C-first");
    // confirm 解決後に dialog が表示される
    alertMock.calls[0]?.buttons[1]?.onPress?.();
    await expect(c).resolves.toBe(true);
    expect(alertMock.calls).toHaveLength(2);
    expect(alertMock.calls[1]?.message).toBe("D-second");
    // dialog も解決できる
    alertMock.calls[1]?.buttons[0]?.onPress?.();
    await expect(d).resolves.toEqual({ dismissed: true, reason: undefined });
  });

  // キューイング: 待機中 (current ではない) 通知が manager.dismiss で remove されたら waiting から外れる
  it("removes a waiting (not current) notification from the queue when it is dismissed externally", async () => {
    const { manager } = setup();
    // A: current として表示中
    const a = manager.confirm({ message: "A" });
    // B, C: waiting に積まれる
    const b = manager.confirm({ message: "B" });
    void manager.confirm({ message: "C" });
    expect(alertMock.calls).toHaveLength(1);
    expect(alertMock.calls[0]?.message).toBe("A");

    // B (waiting 中) を直接 dismiss する → resolveConfirm(B, false) → remove B が走る
    // adapter listener が waiting から B を除去（splice 経路）
    const allBefore = manager.getAll();
    const bNotification = allBefore.find((n) => n.message === "B");
    expect(bNotification).toBeDefined();
    manager.dismiss(bNotification!.id);
    await expect(b).resolves.toBe(false);

    // A を解決すると次は C（B は既に waiting から外れている）
    alertMock.calls[0]?.buttons[1]?.onPress?.();
    await expect(a).resolves.toBe(true);
    expect(alertMock.calls).toHaveLength(2);
    expect(alertMock.calls[1]?.message).toBe("C");
  });

  // キューイング: 対象外 kind (handleConfirm:false の confirm) は他種の表示を阻害しない
  it("ignored kinds do not block other kinds in the queue", async () => {
    alertMock.calls.length = 0;
    const manager = createNotificationManager();
    // confirm を抑止した状態で adapter を install
    createAlertConfirmAdapter(manager, { handleConfirm: false });
    // 抑止された confirm → 待機キューに積まれない
    void manager.confirm({ message: "ignored" });
    expect(alertMock.calls).toHaveLength(0);
    // 続いて dialog → 直ちに表示される（confirm が waiting に居ない）
    const d = manager.dialog({ message: "shown" });
    expect(alertMock.calls).toHaveLength(1);
    expect(alertMock.calls[0]?.message).toBe("shown");
    alertMock.calls[0]?.buttons[0]?.onPress?.();
    await expect(d).resolves.toEqual({ dismissed: true, reason: undefined });
  });
});
