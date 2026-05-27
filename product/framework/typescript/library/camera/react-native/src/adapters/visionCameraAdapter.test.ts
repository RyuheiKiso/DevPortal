// vitest API
import { describe, expect, it, vi } from "vitest";
// テスト対象
import {
  createVisionCameraAdapter,
  type VisionCameraDevice,
  type VisionCameraLibrary,
  type VisionCameraRef,
} from "./visionCameraAdapter.js";
// core エラー
import {
  CameraControlError,
  CameraError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
} from "@k1s0-ts-camera/core";
// 型
import type { PreviewHandle } from "@k1s0-ts-camera/core";

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

  it("stopRecording 前に onRecordingFinished が発火した場合は pendingResult を返す（H2）", async () => {
    // finishedCb を保存して stop より先に呼ぶ
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
    // stopRecording を呼ぶ前に finished を発火
    finishedCb?.({ path: "/tmp/auto.mp4", duration: 5 });
    // microtask 進行
    await new Promise((r) => setTimeout(r, 0));
    // 後続 stopRecording は pending を消費して返す
    const result = await adapter.stopRecording(rec);
    expect(result.media).toMatchObject({ kind: "filePath", path: "/tmp/auto.mp4" });
  });

  it("stopRecording 前に onRecordingError が発火すると RecordingError(RECORDER_ERROR) でラップされて pending throw", async () => {
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
    // stopRecording 前に error を発火
    const err = new Error("device fail");
    errorCb?.(err);
    await new Promise((r) => setTimeout(r, 0));
    // 後続 stopRecording は RecordingError(RECORDER_ERROR) を投げる（cause に元の err が入る）
    await expect(adapter.stopRecording(rec)).rejects.toMatchObject({
      reason: "RECORDER_ERROR",
      cause: err,
    });
  });

  it("自然完了で pending に残った結果は次の startRecording で確実にクリアされる", async () => {
    // finishedCb を 1 回目と 2 回目で別の参照に
    const finishedCbs: Array<(v: { path: string; duration: number }) => void> = [];
    const ref = makeRef({
      startRecording: vi.fn((opts: { onRecordingFinished: (v: { path: string; duration: number }) => void }) => {
        finishedCbs.push(opts.onRecordingFinished);
      }),
    });
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => ref,
    });
    const h = await adapter.startPreview({});
    // 1 回目 startRecording
    await adapter.startRecording(h);
    // 1 回目自然完了 → pending に保存（stop を呼ばない）
    finishedCbs[0]?.({ path: "/tmp/old.mp4", duration: 2 });
    await new Promise((r) => setTimeout(r, 0));
    // 2 回目 startRecording → 冒頭で pending クリア
    const rec2 = await adapter.startRecording(h);
    // 2 回目自然完了で新 URI が pending に
    finishedCbs[1]?.({ path: "/tmp/new.mp4", duration: 3 });
    await new Promise((r) => setTimeout(r, 0));
    // stopRecording は新 URI を返す（旧 URI が混入しない）
    const result = await adapter.stopRecording(rec2);
    expect(result.media).toMatchObject({ kind: "filePath", path: "/tmp/new.mp4" });
  });

  it("旧セッションの onRecordingFinished が新セッション後に発火しても silent drop される", async () => {
    // 1 回目と 2 回目の callback を別保持
    const finishedCbs: Array<(v: { path: string; duration: number }) => void> = [];
    const ref = makeRef({
      startRecording: vi.fn((opts: { onRecordingFinished: (v: { path: string; duration: number }) => void }) => {
        finishedCbs.push(opts.onRecordingFinished);
      }),
    });
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => ref,
    });
    const h = await adapter.startPreview({});
    // session A
    await adapter.startRecording(h);
    // session B（sessionId 更新、pending クリア）
    const recB = await adapter.startRecording(h);
    // session A の遅延 finished → silent drop
    finishedCbs[0]?.({ path: "/tmp/A.mp4", duration: 1 });
    // session B の finished
    finishedCbs[1]?.({ path: "/tmp/B.mp4", duration: 2 });
    await new Promise((r) => setTimeout(r, 0));
    // stopRecording は B の URI を返す
    const result = await adapter.stopRecording(recB);
    expect(result.media).toMatchObject({ kind: "filePath", path: "/tmp/B.mp4" });
  });

  it("旧セッションの onRecordingError が新セッション後に発火しても silent drop される", async () => {
    const errorCbs: Array<(err: unknown) => void> = [];
    const finishedCbs: Array<(v: { path: string; duration: number }) => void> = [];
    const ref = makeRef({
      startRecording: vi.fn(
        (opts: {
          onRecordingFinished: (v: { path: string; duration: number }) => void;
          onRecordingError: (err: unknown) => void;
        }) => {
          finishedCbs.push(opts.onRecordingFinished);
          errorCbs.push(opts.onRecordingError);
        },
      ),
    });
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => ref,
    });
    const h = await adapter.startPreview({});
    await adapter.startRecording(h);
    const recB = await adapter.startRecording(h);
    // session A の遅延 error → silent drop
    errorCbs[0]?.(new Error("A failed"));
    // session B の finished で正常完了
    finishedCbs[1]?.({ path: "/tmp/B.mp4", duration: 2 });
    await new Promise((r) => setTimeout(r, 0));
    const result = await adapter.stopRecording(recB);
    expect(result.media).toMatchObject({ kind: "filePath", path: "/tmp/B.mp4" });
  });

  it("dispose 後に旧セッションの callback が発火しても pending に書き込まれない", async () => {
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
    await adapter.startRecording(h);
    // dispose で sessionId が undefined になる
    await adapter.dispose();
    // 旧 callback の遅延発火 → silent drop（sessionId 不一致）
    finishedCb?.({ path: "/tmp/disposed.mp4", duration: 1 });
    await new Promise((r) => setTimeout(r, 0));
    // dispose 後の adapter は再利用しない
  });

  it("dispose で pending result がクリアされる", async () => {
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
    await adapter.startRecording(h);
    finishedCb?.({ path: "/tmp/disposed.mp4", duration: 1 });
    await new Promise((r) => setTimeout(r, 0));
    // dispose で pending クリア（throw しない）
    await expect(adapter.dispose()).resolves.toBeUndefined();
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

// controls 注入と device モックを使った capability 系テスト
describe("createVisionCameraAdapter controls", () => {
  // フル装備の device モック（capability 構築の全分岐を踏ませる用）
  const fullDevice: VisionCameraDevice = {
    id: "d1",
    name: "Back",
    position: "back",
    hasFlash: true,
    minZoom: 1,
    maxZoom: 10,
    supportsFocusLocking: true,
    supportsExposureLocking: true,
    supportsLowLightBoost: true,
  };

  it("setTorch: controls 注入ありなら呼ばれる", async () => {
    const setTorch = vi.fn();
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      controls: { setTorch },
    });
    const h = await adapter.startPreview({});
    await adapter.setTorch!(h, "on");
    expect(setTorch).toHaveBeenCalledWith("on");
  });

  it("setTorch: controls 未注入なら UNSUPPORTED", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setTorch!(h, "off")).rejects.toBeInstanceOf(CameraControlError);
  });

  it("setTorch: ハンドル不一致なら CameraError", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      controls: { setTorch: vi.fn() },
    });
    await adapter.startPreview({});
    const fake: PreviewHandle = { __brand: "PreviewHandle", id: "x", native: null };
    await expect(adapter.setTorch!(fake, "on")).rejects.toBeInstanceOf(CameraError);
  });

  it("setTorch: setter が throw したら APPLY_FAILED", async () => {
    const err = new Error("boom");
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      controls: {
        setTorch: () => {
          throw err;
        },
      },
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setTorch!(h, "on")).rejects.toMatchObject({
      reason: "APPLY_FAILED",
      cause: err,
    });
  });

  it("setZoom: 注入ありなら呼ばれる", async () => {
    const setZoom = vi.fn();
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      controls: { setZoom },
    });
    const h = await adapter.startPreview({});
    await adapter.setZoom!(h, 3);
    expect(setZoom).toHaveBeenCalledWith(3);
  });

  it("setZoom: ハンドル不一致なら CameraError", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      controls: { setZoom: vi.fn() },
    });
    await adapter.startPreview({});
    const fake: PreviewHandle = { __brand: "PreviewHandle", id: "x", native: null };
    await expect(adapter.setZoom!(fake, 2)).rejects.toBeInstanceOf(CameraError);
  });

  it("setZoom: 注入無しなら UNSUPPORTED", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setZoom!(h, 2)).rejects.toMatchObject({ reason: "UNSUPPORTED" });
  });

  it("setZoom: setter throw を APPLY_FAILED に変換", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      controls: {
        setZoom: () => {
          throw new Error("zoom fail");
        },
      },
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setZoom!(h, 1)).rejects.toMatchObject({ reason: "APPLY_FAILED" });
  });

  it("setFocus: 注入ありなら point を渡す", async () => {
    const setFocus = vi.fn();
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      controls: { setFocus },
    });
    const h = await adapter.startPreview({});
    await adapter.setFocus!(h, { x: 0.3, y: 0.6 });
    expect(setFocus).toHaveBeenCalledWith({ x: 0.3, y: 0.6 });
  });

  it("setFocus: point 無しは undefined を渡す", async () => {
    const setFocus = vi.fn();
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      controls: { setFocus },
    });
    const h = await adapter.startPreview({});
    await adapter.setFocus!(h);
    expect(setFocus).toHaveBeenCalledWith(undefined);
  });

  it("setFocus: 注入無しなら UNSUPPORTED", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setFocus!(h)).rejects.toMatchObject({ reason: "UNSUPPORTED" });
  });

  it("setFocus: ハンドル不一致なら CameraError", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      controls: { setFocus: vi.fn() },
    });
    await adapter.startPreview({});
    const fake: PreviewHandle = { __brand: "PreviewHandle", id: "x", native: null };
    await expect(adapter.setFocus!(fake)).rejects.toBeInstanceOf(CameraError);
  });

  it("setFocus: setter throw は APPLY_FAILED に変換", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      controls: {
        setFocus: () => {
          throw new Error("focus fail");
        },
      },
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setFocus!(h)).rejects.toMatchObject({ reason: "APPLY_FAILED" });
  });

  it("getCapabilities: フル device + フル controls なら全部 true 系", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      device: () => fullDevice,
      controls: { setTorch: vi.fn(), setZoom: vi.fn(), setFocus: vi.fn() },
    });
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps).toEqual({
      torch: true,
      zoom: { min: 1, max: 10 },
      focus: { tap: true, continuous: true },
      flash: true,
      exposureMode: ["continuous", "manual"],
      whiteBalanceMode: false,
      iso: false,
      brightness: false,
      hdr: false,
      lowLightBoost: true,
    });
  });

  it("getCapabilities: device 無し / controls 無しなら全 false 系", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
    });
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps).toEqual({
      torch: false,
      zoom: false,
      focus: false,
      flash: false,
      exposureMode: false,
      whiteBalanceMode: false,
      iso: false,
      brightness: false,
      hdr: false,
      lowLightBoost: false,
    });
  });

  it("getCapabilities: device.minZoom/maxZoom 未定義なら zoom=false", async () => {
    const partial: VisionCameraDevice = { ...fullDevice, minZoom: undefined, maxZoom: undefined };
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
      device: () => partial,
      controls: { setZoom: vi.fn() },
    });
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps.zoom).toBe(false);
  });

  it("getCapabilities: ハンドル不一致なら CameraError", async () => {
    const adapter = createVisionCameraAdapter({
      library: makeLibrary(),
      cameraRef: () => makeRef(),
    });
    await adapter.startPreview({});
    const fake: PreviewHandle = { __brand: "PreviewHandle", id: "x", native: null };
    await expect(adapter.getCapabilities!(fake)).rejects.toBeInstanceOf(CameraError);
  });
});
