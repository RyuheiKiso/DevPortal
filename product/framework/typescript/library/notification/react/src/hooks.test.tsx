import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import * as React from "react";
import type { NotificationManager } from "@k1s0-ts-notification/core";
import { NotificationProvider } from "./NotificationProvider.js";
import {
  useConfirm,
  useConfirmResolver,
  useDialog,
  useDialogResolver,
  useToast,
} from "./hooks.js";

function createMockManager(): NotificationManager {
  return {
    toast: vi.fn(() => "toast-id"),
    dialog: vi.fn(async () => ({ dismissed: true })),
    confirm: vi.fn(async () => true),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
    resolveDialog: vi.fn(),
    resolveConfirm: vi.fn(),
    getAll: vi.fn(() => []),
    subscribe: vi.fn(() => () => undefined),
    dispose: vi.fn(),
  };
}

describe("notification hook aliases", () => {
  it("各糖衣 hook が manager の対応メソッドを返す", async () => {
    const manager = createMockManager();
    const captured: Partial<{
      toast: ReturnType<typeof useToast>;
      dialog: ReturnType<typeof useDialog>;
      confirm: ReturnType<typeof useConfirm>;
      resolveDialog: ReturnType<typeof useDialogResolver>;
      resolveConfirm: ReturnType<typeof useConfirmResolver>;
    }> = {};

    function Probe(): React.JSX.Element {
      captured.toast = useToast();
      captured.dialog = useDialog();
      captured.confirm = useConfirm();
      captured.resolveDialog = useDialogResolver();
      captured.resolveConfirm = useConfirmResolver();
      return <>{null}</>;
    }

    act(() => {
      create(
        <NotificationProvider manager={manager}>
          <Probe />
        </NotificationProvider>,
      );
    });

    expect(captured.toast?.({ message: "saved" })).toBe("toast-id");
    await expect(captured.dialog?.({ message: "open" })).resolves.toEqual({ dismissed: true });
    await expect(captured.confirm?.({ message: "sure?" })).resolves.toBe(true);
    captured.resolveDialog?.("dialog-id", "ok");
    captured.resolveConfirm?.("confirm-id", false);

    expect(manager.toast).toHaveBeenCalledWith({ message: "saved" });
    expect(manager.dialog).toHaveBeenCalledWith({ message: "open" });
    expect(manager.confirm).toHaveBeenCalledWith({ message: "sure?" });
    expect(manager.resolveDialog).toHaveBeenCalledWith("dialog-id", "ok");
    expect(manager.resolveConfirm).toHaveBeenCalledWith("confirm-id", false);
  });
});
