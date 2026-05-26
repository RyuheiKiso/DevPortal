// vitest API
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { createWindowsAdapter, type WindowsCameraImpl } from "./windowsAdapter.js";
// core エラー
import { DeviceUnavailableError, RecordingError, ScannerError } from "@k1s0-ts-camera/core";
// 型
import type { PreviewHandle, RecordingHandle } from "@k1s0-ts-camera/core";

// プレビュー / 録画ハンドル fixtures
const previewHandle: PreviewHandle = { __brand: "PreviewHandle", id: "p1", native: { x: 1 } };
const recordingHandle: RecordingHandle = { __brand: "RecordingHandle", id: "r1", native: { y: 2 } };

describe("createWindowsAdapter スタブ（mediaCapture 未指定）", () => {
  it("listDevices は空配列", async () => {
    const adapter = createWindowsAdapter();
    await expect(adapter.listDevices()).resolves.toEqual([]);
  });

  it("getPermission / requestPermission は unavailable", async () => {
    const adapter = createWindowsAdapter();
    await expect(adapter.getPermission({ camera: true })).resolves.toBe("unavailable");
    await expect(adapter.requestPermission({ camera: true })).resolves.toBe("unavailable");
  });

  it("startPreview / stopPreview / takePicture は DeviceUnavailableError", async () => {
    const adapter = createWindowsAdapter();
    await expect(adapter.startPreview({})).rejects.toBeInstanceOf(DeviceUnavailableError);
    await expect(adapter.stopPreview(previewHandle)).rejects.toBeInstanceOf(DeviceUnavailableError);
    await expect(adapter.takePicture(previewHandle)).rejects.toBeInstanceOf(DeviceUnavailableError);
  });

  it("startRecording / stopRecording は RecordingError", async () => {
    const adapter = createWindowsAdapter();
    await expect(adapter.startRecording(previewHandle)).rejects.toBeInstanceOf(RecordingError);
    await expect(adapter.stopRecording(recordingHandle)).rejects.toBeInstanceOf(RecordingError);
  });

  it("scanBarcode は ScannerError", async () => {
    const adapter = createWindowsAdapter();
    await expect(
      adapter.scanBarcode(previewHandle, { formats: ["qr_code"] }, () => {}),
    ).rejects.toBeInstanceOf(ScannerError);
  });

  it("dispose は no-op", async () => {
    const adapter = createWindowsAdapter();
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});

describe("createWindowsAdapter 注入実装あり", () => {
  it("全メソッドが impl に委譲される", async () => {
    const impl: WindowsCameraImpl = {
      listDevices: vi.fn(async () => [{ id: "d1", label: "Cam" }] as const),
      getPermission: vi.fn(async () => "granted"),
      requestPermission: vi.fn(async () => "granted"),
      startPreview: vi.fn(async () => ({ id: "p1", native: { x: 1 } })),
      stopPreview: vi.fn(async () => {}),
      takePicture: vi.fn(async () => ({
        id: "ph",
        media: { kind: "filePath" as const, path: "/tmp/p.jpg", mimeType: "image/jpeg" },
        width: 10,
        height: 10,
        capturedAt: 0,
      })),
      startRecording: vi.fn(async () => ({ id: "r1", native: { y: 2 } })),
      stopRecording: vi.fn(async () => ({
        id: "r1",
        media: { kind: "filePath" as const, path: "/tmp/v.mp4", mimeType: "video/mp4" },
        durationMs: 100,
      })),
      scanBarcode: vi.fn(async (_h, _c, _cb) => () => {}),
      dispose: vi.fn(async () => {}),
    };
    const adapter = createWindowsAdapter({ mediaCapture: impl });
    // listDevices
    await expect(adapter.listDevices()).resolves.toEqual([{ id: "d1", label: "Cam" }]);
    // permission
    await expect(adapter.getPermission({ camera: true })).resolves.toBe("granted");
    await expect(adapter.requestPermission({ camera: true })).resolves.toBe("granted");
    // preview
    const handle = await adapter.startPreview({});
    expect(handle.__brand).toBe("PreviewHandle");
    await adapter.stopPreview(handle);
    // photo
    const photo = await adapter.takePicture(handle);
    expect(photo.media.kind).toBe("filePath");
    // recording
    const rec = await adapter.startRecording(handle);
    expect(rec.__brand).toBe("RecordingHandle");
    const result = await adapter.stopRecording(rec);
    expect(result.durationMs).toBe(100);
    // scanBarcode
    const cancel = await adapter.scanBarcode(handle, { formats: ["qr_code"] }, () => {});
    expect(typeof cancel).toBe("function");
    // dispose
    await adapter.dispose();
    expect(impl.dispose).toHaveBeenCalled();
  });

  it("一部メソッドのみ実装した impl で graceful fail", async () => {
    // listDevices と getPermission のみ実装
    const impl: WindowsCameraImpl = {
      listDevices: vi.fn(async () => []),
      getPermission: vi.fn(async () => "prompt"),
    };
    const adapter = createWindowsAdapter({ mediaCapture: impl });
    await expect(adapter.getPermission({ camera: true })).resolves.toBe("prompt");
    // requestPermission も未実装 → unavailable
    await expect(adapter.requestPermission({ camera: true })).resolves.toBe("unavailable");
    // takePicture は未実装 → DeviceUnavailableError
    await expect(adapter.takePicture(previewHandle)).rejects.toBeInstanceOf(DeviceUnavailableError);
    // dispose 関数が無くても OK
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});
