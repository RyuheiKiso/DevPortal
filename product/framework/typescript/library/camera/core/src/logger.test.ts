// vitest API
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { attachLoggerBridge } from "./logger.js";
import type { LoggerLike } from "./logger.js";
// manager 経由でイベントを emit するため createCameraManager を利用
import { createCameraManager } from "./manager.js";
import type { CameraAdapter } from "./adapter.js";
import { CameraError } from "./errors.js";
import type {
  BarcodeScanResult,
  PhotoResult,
  PreviewHandle,
  RecordingHandle,
  RecordingResult,
  ScannerConfig,
} from "./types.js";

// 共通のプレビューハンドル
const previewHandle: PreviewHandle = { __brand: "PreviewHandle", id: "p", native: null };
// 録画ハンドル
const recordingHandle: RecordingHandle = { __brand: "RecordingHandle", id: "r", native: null };
// 静止画結果
const photoResult: PhotoResult = {
  id: "ph",
  media: { kind: "dataUrl", value: "data:,a", mimeType: "image/jpeg" },
  width: 1,
  height: 1,
  capturedAt: 0,
};
// 録画結果
const recordingResult: RecordingResult = {
  id: "r",
  media: { kind: "filePath", path: "/tmp/v", mimeType: "video/mp4" },
  durationMs: 10,
};
// スキャン結果
const scanResult: BarcodeScanResult = {
  id: "s",
  format: "qr_code",
  value: "x",
  scannedAt: 0,
};

// adapter mock を生成
function makeAdapter(): { adapter: CameraAdapter; trigger: (r: BarcodeScanResult) => void } {
  let scannerCb: ((r: BarcodeScanResult) => void) | undefined;
  const adapter: CameraAdapter = {
    id: "test",
    listDevices: vi.fn(async () => []),
    getPermission: vi.fn(async () => "granted"),
    requestPermission: vi.fn(async () => "granted"),
    startPreview: vi.fn(async () => previewHandle),
    stopPreview: vi.fn(async () => {}),
    takePicture: vi.fn(async () => photoResult),
    startRecording: vi.fn(async () => recordingHandle),
    stopRecording: vi.fn(async () => recordingResult),
    pauseRecording: vi.fn(async () => {}),
    resumeRecording: vi.fn(async () => {}),
    scanBarcode: vi.fn(async (_h: PreviewHandle, _c: ScannerConfig, cb) => {
      scannerCb = cb;
      return () => {};
    }),
    dispose: vi.fn(async () => {}),
  };
  return {
    adapter,
    trigger: (r) => scannerCb?.(r),
  };
}

// LoggerLike の vi.fn 実装
function makeLogger(): LoggerLike {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("attachLoggerBridge", () => {
  it("全イベント種別をロガーに流す", async () => {
    const { adapter, trigger } = makeAdapter();
    const manager = createCameraManager(adapter);
    const logger = makeLogger();
    attachLoggerBridge(manager, logger);
    // 各種イベントを発生
    await manager.startPreview();
    await manager.takePicture();
    const session = await manager.startRecording();
    await session.pause();
    await session.resume();
    await session.stop();
    await manager.startScanning({ formats: ["qr_code"] }, () => {});
    trigger(scanResult);
    await manager.getPermission({ camera: true });
    await manager.stopPreview();
    // info ログがいくつか呼ばれている
    expect((logger.info as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    // debug は scan のみ
    expect(logger.debug).toHaveBeenCalledWith("[camera] scan", expect.any(Object));
  });

  it("filter で対象イベントを限定できる", async () => {
    const { adapter } = makeAdapter();
    const manager = createCameraManager(adapter);
    const logger = makeLogger();
    attachLoggerBridge(manager, logger, { events: ["preview-start"] });
    await manager.startPreview();
    await manager.takePicture();
    // preview-start のみ通り、photo は filter で除外
    expect(logger.info).toHaveBeenCalledWith("[camera] preview-start", expect.any(Object));
    // photo は通らない
    expect(logger.info).not.toHaveBeenCalledWith("[camera] photo", expect.any(Object));
  });

  it("error event は error レベルでログする", async () => {
    const { adapter } = makeAdapter();
    // listDevices が CameraError を投げるように差し替え
    (adapter.listDevices as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      throw new CameraError("boom");
    });
    const manager = createCameraManager(adapter);
    const logger = makeLogger();
    attachLoggerBridge(manager, logger);
    await expect(manager.listDevices()).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "[camera] error",
      expect.objectContaining({ code: "CAMERA_ERROR" }),
    );
  });

  it("detach で購読解除", async () => {
    const { adapter } = makeAdapter();
    const manager = createCameraManager(adapter);
    const logger = makeLogger();
    const detach = attachLoggerBridge(manager, logger);
    detach();
    await manager.startPreview();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
