// vitest API
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { attachNotificationBridge } from "./notification.js";
import type { NotificationManagerLike } from "./notification.js";
// manager 経由でイベントを emit するため
import { createCameraManager } from "./manager.js";
import type { CameraAdapter } from "./adapter.js";
import {
  CameraError,
  CameraNotReadyError,
  DeviceUnavailableError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
} from "./errors.js";
import type { PreviewHandle, RecordingHandle } from "./types.js";

// プレビュー / 録画用のハンドル
const previewHandle: PreviewHandle = { __brand: "PreviewHandle", id: "p", native: null };
const recordingHandle: RecordingHandle = { __brand: "RecordingHandle", id: "r", native: null };

// 通知 mock の生成（dialog は明示的に resolve させる）
function makeNotification(dialogResult: { dismissed: true; reason?: string } = { dismissed: true }) {
  const notification: NotificationManagerLike = {
    toast: vi.fn(() => "toast-id"),
    dialog: vi.fn(async () => dialogResult),
  };
  return notification;
}

// adapter mock 生成 + 任意の操作で error を投げる
function makeAdapter(errorToThrow: unknown): CameraAdapter {
  return {
    id: "test",
    listDevices: vi.fn(async () => {
      throw errorToThrow;
    }),
    getPermission: vi.fn(async () => "granted"),
    requestPermission: vi.fn(async () => "granted"),
    startPreview: vi.fn(async () => previewHandle),
    stopPreview: vi.fn(async () => {}),
    takePicture: vi.fn(async () => ({
      id: "ph",
      media: { kind: "dataUrl" as const, value: "data:,x", mimeType: "image/jpeg" },
      width: 1,
      height: 1,
      capturedAt: 0,
    })),
    startRecording: vi.fn(async () => recordingHandle),
    stopRecording: vi.fn(async () => ({
      id: "r",
      media: { kind: "filePath" as const, path: "/tmp", mimeType: "video/mp4" },
      durationMs: 0,
    })),
    scanBarcode: vi.fn(async () => () => {}),
    dispose: vi.fn(async () => {}),
  };
}

describe("attachNotificationBridge", () => {
  it("PERMISSION_DENIED は warning toast を出す", async () => {
    const err = new PermissionDeniedError({ camera: true });
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification);
    await expect(manager.listDevices()).rejects.toBe(err);
    expect(notification.toast).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warning", dedupeKey: "camera:permission-denied" }),
    );
  });

  it("PERMISSION_BLOCKED は dialog を出し open-settings 押下時にコールバック実行", async () => {
    const err = new PermissionDeniedError({ camera: true }, { status: "blocked" });
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const dialogResult = { dismissed: true as const, reason: "open-settings" };
    const notification = makeNotification(dialogResult);
    const openSettings = vi.fn();
    attachNotificationBridge(manager, notification, { openSettings });
    await expect(manager.listDevices()).rejects.toBe(err);
    expect(notification.dialog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warning",
        actions: expect.any(Array),
      }),
    );
    // Promise の解決を待つ
    await Promise.resolve();
    await Promise.resolve();
    expect(openSettings).toHaveBeenCalled();
  });

  it("PERMISSION_BLOCKED で openSettings 未指定なら actions undefined になる", async () => {
    const err = new PermissionDeniedError({ camera: true }, { status: "blocked" });
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification);
    await expect(manager.listDevices()).rejects.toBe(err);
    const dialogCall = (notification.dialog as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(dialogCall.actions).toBeUndefined();
  });

  it("PERMISSION_BLOCKED で reason が open-settings 以外なら openSettings を呼ばない", async () => {
    const err = new PermissionDeniedError({ camera: true }, { status: "blocked" });
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification = makeNotification({ dismissed: true, reason: "cancel" });
    const openSettings = vi.fn();
    attachNotificationBridge(manager, notification, { openSettings });
    await expect(manager.listDevices()).rejects.toBe(err);
    await Promise.resolve();
    await Promise.resolve();
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("dialog Promise が reject しても握りつぶす", async () => {
    const err = new PermissionDeniedError({ camera: true }, { status: "blocked" });
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification: NotificationManagerLike = {
      toast: vi.fn(() => "id"),
      dialog: vi.fn(async () => {
        throw new Error("rejected");
      }),
    };
    attachNotificationBridge(manager, notification);
    // dialog 内の例外で発火側が壊れないこと
    await expect(manager.listDevices()).rejects.toBe(err);
    // microtask を流す
    await Promise.resolve();
    await Promise.resolve();
  });

  it("RECORDING_ERROR は error toast を出す", async () => {
    const err = new RecordingError("UNSUPPORTED_MIME", { message: "no codec" });
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification);
    await expect(manager.listDevices()).rejects.toBe(err);
    expect(notification.toast).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", message: "no codec" }),
    );
  });

  it("recordingErrorMessage の上書きが効く", async () => {
    const err = new RecordingError("UNSUPPORTED_MIME");
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification, { recordingErrorMessage: "override" });
    await expect(manager.listDevices()).rejects.toBe(err);
    expect(notification.toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "override" }),
    );
  });

  it("SCANNER_ERROR は warning toast", async () => {
    const err = new ScannerError("ALREADY_SCANNING");
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification);
    await expect(manager.listDevices()).rejects.toBe(err);
    expect(notification.toast).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warning", dedupeKey: "camera:scanner-error" }),
    );
  });

  it("DEVICE_UNAVAILABLE は error toast", async () => {
    const err = new DeviceUnavailableError("no cam");
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification);
    await expect(manager.listDevices()).rejects.toBe(err);
    expect(notification.toast).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", dedupeKey: "camera:device-unavailable" }),
    );
  });

  it("CAMERA_NOT_READY 等は汎用 error toast", async () => {
    const err = new CameraNotReadyError("not ready yet");
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification);
    await expect(manager.listDevices()).rejects.toBe(err);
    expect(notification.toast).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", dedupeKey: "camera:generic" }),
    );
  });

  it("汎用 CameraError も generic 経路を通る", async () => {
    const err = new CameraError("boom");
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification);
    await expect(manager.listDevices()).rejects.toBe(err);
    expect(notification.toast).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "camera:generic" }),
    );
  });

  it("dedupe=false なら dedupeKey が付かない", async () => {
    const err = new PermissionDeniedError({ camera: true });
    const adapter = makeAdapter(err);
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification, { dedupe: false });
    await expect(manager.listDevices()).rejects.toBe(err);
    const toastCall = (notification.toast as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(toastCall.dedupeKey).toBeUndefined();
  });

  it("permissionDeniedMessage / permissionBlockedMessage の上書きが効く", async () => {
    const deniedErr = new PermissionDeniedError({ camera: true });
    const adapter = makeAdapter(deniedErr);
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification, {
      permissionDeniedMessage: "custom-denied",
      permissionBlockedMessage: "custom-blocked",
    });
    await expect(manager.listDevices()).rejects.toBe(deniedErr);
    expect(notification.toast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "custom-denied" }),
    );
  });

  it("error 以外のイベントは無視する", async () => {
    // 正常系の adapter
    const adapter: CameraAdapter = {
      id: "ok",
      listDevices: vi.fn(async () => []),
      getPermission: vi.fn(async () => "granted"),
      requestPermission: vi.fn(async () => "granted"),
      startPreview: vi.fn(async () => previewHandle),
      stopPreview: vi.fn(async () => {}),
      takePicture: vi.fn(async () => ({
        id: "ph",
        media: { kind: "dataUrl" as const, value: "data:,x", mimeType: "image/jpeg" },
        width: 1,
        height: 1,
        capturedAt: 0,
      })),
      startRecording: vi.fn(async () => recordingHandle),
      stopRecording: vi.fn(async () => ({
        id: "r",
        media: { kind: "filePath" as const, path: "/tmp", mimeType: "video/mp4" },
        durationMs: 0,
      })),
      scanBarcode: vi.fn(async () => () => {}),
      dispose: vi.fn(async () => {}),
    };
    const manager = createCameraManager(adapter);
    const notification = makeNotification();
    attachNotificationBridge(manager, notification);
    await manager.startPreview();
    await manager.takePicture();
    expect(notification.toast).not.toHaveBeenCalled();
    expect(notification.dialog).not.toHaveBeenCalled();
  });
});
