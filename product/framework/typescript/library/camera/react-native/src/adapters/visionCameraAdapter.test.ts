// vitest API
import { describe, expect, it, vi } from "vitest";
// テスト対象
import {
  createVisionCameraAdapter,
  type VisionCameraLibrary,
  type VisionCameraRef,
} from "./visionCameraAdapter.js";
// core エラー
import {
  CameraError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
} from "@k1s0-ts-camera/core";

// ライブラリ mock を生成
function makeLibrary(overrides: Partial<VisionCameraLibrary["Camera"]> = {}): VisionCameraLibrary {
  return {
    Camera: {
      getAvailableCameraDevices: vi.fn(async () => [
        { id: "d1", name: "Back", position: "back" },
        { id: "d2", name: "Front", position: "front" },
        { id: "d3", name: "USB", position: "external" },
        { id: "d4", name: "Other", position: "unknown" },
      ]),
      getCameraPermissionStatus: vi.fn(() => "granted"),
      getMicrophonePermissionStatus: vi.fn(() => "granted"),
      requestCameraPermission: vi.fn(async () => "granted"),
      requestMicrophonePermission: vi.fn(async () => "granted"),
      ...overrides,
    },
  };
}

// CameraRef mock を生成
function makeRef(overrides: Partial<VisionCameraRef> = {}): VisionCameraRef {
  return {
    takePhoto: vi.fn(async () => ({ path: "/tmp/photo.jpg", width: 100, height: 200 })),
    startRecording: vi.fn(() => {}),
    stopRecording: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("createVisionCameraAdapter", () => {
  it("listDevices: facing マッピングを含む", async () => {
    const library = makeLibrary();
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    const list = await adapter.listDevices();
    expect(list).toEqual([
      { id: "d1", label: "Back", facing: "back" },
      { id: "d2", label: "Front", facing: "front" },
      { id: "d3", label: "USB", facing: "external" },
      { id: "d4", label: "Other", facing: undefined },
    ]);
  });

  it("getPermission: camera のみ", async () => {
    const library = makeLibrary({ getCameraPermissionStatus: vi.fn(() => "granted") });
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    await expect(adapter.getPermission({ camera: true })).resolves.toBe("granted");
  });

  it("getPermission: 各種 status マッピング", async () => {
    for (const [input, expected] of [
      ["granted", "granted"],
      ["not-determined", "prompt"],
      ["denied", "blocked"],
      ["restricted", "unavailable"],
      ["unknown", "unavailable"],
    ] as const) {
      const library = makeLibrary({ getCameraPermissionStatus: vi.fn(() => input) });
      const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
      await expect(adapter.getPermission({ camera: true })).resolves.toBe(expected);
    }
  });

  it("getPermission: mic 含む worst を採用", async () => {
    const library = makeLibrary({
      getCameraPermissionStatus: vi.fn(() => "granted"),
      getMicrophonePermissionStatus: vi.fn(() => "denied"),
    });
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    await expect(adapter.getPermission({ camera: true, microphone: true })).resolves.toBe(
      "blocked",
    );
  });

  it("getPermission: mic ありで cam が worst の場合は cam を返す", async () => {
    const library = makeLibrary({
      getCameraPermissionStatus: vi.fn(() => "restricted"),
      getMicrophonePermissionStatus: vi.fn(() => "granted"),
    });
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    await expect(adapter.getPermission({ camera: true, microphone: true })).resolves.toBe(
      "unavailable",
    );
  });

  it("requestPermission: cam denied で PermissionDeniedError", async () => {
    const library = makeLibrary({ requestCameraPermission: vi.fn(async () => "denied") });
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    await expect(adapter.requestPermission({ camera: true })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("requestPermission: mic denied で PermissionDeniedError", async () => {
    const library = makeLibrary({
      requestCameraPermission: vi.fn(async () => "granted"),
      requestMicrophonePermission: vi.fn(async () => "denied"),
    });
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    await expect(
      adapter.requestPermission({ camera: true, microphone: true }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("requestPermission: 両方 granted で granted", async () => {
    const library = makeLibrary();
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    await expect(adapter.requestPermission({ camera: true, microphone: true })).resolves.toBe(
      "granted",
    );
  });

  it("requestPermission: mic が cam より worst なら mic を返す", async () => {
    const library = makeLibrary({
      requestCameraPermission: vi.fn(async () => "granted"),
      requestMicrophonePermission: vi.fn(async () => "not-determined"),
    });
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    await expect(adapter.requestPermission({ camera: true, microphone: true })).resolves.toBe(
      "prompt",
    );
  });

  it("requestPermission: cam=prompt + mic=granted で worst（prompt）を返す", async () => {
    const library = makeLibrary({
      requestCameraPermission: vi.fn(async () => "not-determined"),
      requestMicrophonePermission: vi.fn(async () => "granted"),
    });
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    await expect(adapter.requestPermission({ camera: true, microphone: true })).resolves.toBe(
      "prompt",
    );
  });

  it("requestPermission: mic 含むが cam が worst の場合は cam を返す", async () => {
    const library = makeLibrary({
      requestCameraPermission: vi.fn(async () => "restricted"),
      requestMicrophonePermission: vi.fn(async () => "granted"),
    });
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    // cam=restricted -> unavailable、mic=granted、worst は cam
    await expect(adapter.requestPermission({ camera: true, microphone: true })).resolves.toBe(
      "unavailable",
    );
  });

  it("requestPermission: camera のみ（mic を含めない）で camResult をそのまま返す", async () => {
    const library = makeLibrary({
      requestCameraPermission: vi.fn(async () => "not-determined"),
      requestMicrophonePermission: vi.fn(async () => "granted"),
    });
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    // microphone を含めないことで mic 要求は走らない
    await expect(adapter.requestPermission({ camera: true })).resolves.toBe("prompt");
  });

  it("startPreview / stopPreview", async () => {
    const library = makeLibrary();
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => makeRef() });
    const h = await adapter.startPreview({ facing: "back" });
    expect(h.__brand).toBe("PreviewHandle");
    await adapter.stopPreview(h);
    // 不一致ハンドルの stopPreview は no-op
    await adapter.stopPreview({ __brand: "PreviewHandle", id: "x", native: null });
  });

  it("takePicture: 正常系", async () => {
    const ref = makeRef();
    const library = makeLibrary();
    const adapter = createVisionCameraAdapter({ library, cameraRef: () => ref });
    const h = await adapter.startPreview({});
    const photo = await adapter.takePicture(h, { quality: 0.8, flash: "auto" });
    expect(photo.media).toMatchObject({ kind: "filePath", path: "/tmp/photo.jpg" });
    expect(ref.takePhoto).toHaveBeenCalled();
  });

  it("takePicture: INVALID_HANDLE", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
    });
    await expect(
      adapter.takePicture({ __brand: "PreviewHandle", id: "x", native: null }),
    ).rejects.toBeInstanceOf(CameraError);
  });

  it("takePicture: ref 未取得で REF_UNAVAILABLE", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => null,
    });
    const h = await adapter.startPreview({});
    await expect(adapter.takePicture(h)).rejects.toMatchObject({ code: "REF_UNAVAILABLE" });
  });

  it("startRecording / stopRecording 正常系", async () => {
    let finishedCb: ((v: { path: string; duration: number }) => void) | undefined;
    const ref = makeRef({
      startRecording: vi.fn((opts: { onRecordingFinished: typeof finishedCb }) => {
        finishedCb = opts.onRecordingFinished;
      }),
    });
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => ref,
    });
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    expect(rec.__brand).toBe("RecordingHandle");
    // stopRecording を呼び、その後 finished コールバックで resolve
    const p = adapter.stopRecording(rec);
    await new Promise((r) => setTimeout(r, 0));
    finishedCb?.({ path: "/tmp/v.mp4", duration: 1 });
    const result = await p;
    expect(result.media.kind).toBe("filePath");
  });

  it("startRecording: INVALID_HANDLE", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
    });
    await expect(
      adapter.startRecording({ __brand: "PreviewHandle", id: "x", native: null }),
    ).rejects.toBeInstanceOf(CameraError);
  });

  it("stopRecording: stop が reject すると RecordingError", async () => {
    const ref = makeRef({
      startRecording: vi.fn(() => {}),
      stopRecording: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => ref,
    });
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    await expect(adapter.stopRecording(rec)).rejects.toBeInstanceOf(RecordingError);
  });

  it("startRecording: onRecordingError 時の reject", async () => {
    let errorCb: ((err: unknown) => void) | undefined;
    const ref = makeRef({
      startRecording: vi.fn((opts: { onRecordingError: typeof errorCb }) => {
        errorCb = opts.onRecordingError;
      }),
    });
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => ref,
    });
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    const p = adapter.stopRecording(rec);
    await new Promise((r) => setTimeout(r, 0));
    errorCb?.(new Error("cam fail"));
    await expect(p).rejects.toBeDefined();
  });

  it("scanBarcode は UNSUPPORTED_FORMAT", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
    });
    await expect(
      adapter.scanBarcode(
        { __brand: "PreviewHandle", id: "x", native: null },
        { formats: ["qr_code"] },
        () => {},
      ),
    ).rejects.toBeInstanceOf(ScannerError);
  });

  it("dispose は state を解放", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
    });
    await adapter.startPreview({});
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});
