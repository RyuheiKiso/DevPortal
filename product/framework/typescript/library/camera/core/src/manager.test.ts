// vitest API
import { beforeEach, describe, expect, it, vi } from "vitest";
// テスト対象
import { createCameraManager } from "./manager.js";
// 型・エラー
import type { CameraAdapter } from "./adapter.js";
import {
  CameraError,
  CameraNotReadyError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
} from "./errors.js";
import type {
  BarcodeScanResult,
  CameraDevice,
  CameraEvent,
  PermissionDescriptor,
  PhotoResult,
  PreviewHandle,
  RecordingHandle,
  RecordingResult,
  ScannerConfig,
} from "./types.js";

// 固定のプレビューハンドル
const previewHandle: PreviewHandle = { __brand: "PreviewHandle", id: "ph-1", native: null };
// 固定の録画ハンドル
const recordingHandle: RecordingHandle = { __brand: "RecordingHandle", id: "rh-1", native: null };
// 固定の PhotoResult
const photoResult: PhotoResult = {
  id: "photo-1",
  media: { kind: "dataUrl", value: "data:,x", mimeType: "image/jpeg" },
  width: 100,
  height: 100,
  capturedAt: 1,
};
// 固定の RecordingResult
const recordingResult: RecordingResult = {
  id: "rh-1",
  media: { kind: "filePath", path: "/tmp/v.mp4", mimeType: "video/mp4" },
  durationMs: 1000,
};
// 固定の scan 結果
const scanResult: BarcodeScanResult = {
  id: "scan-1",
  format: "qr_code",
  value: "https://example.com",
  scannedAt: 1,
};

// adapter のフル mock を生成するヘルパ
function makeAdapter(overrides: Partial<CameraAdapter> = {}): CameraAdapter {
  // 既定のスキャナ購読解除関数
  const defaultUnsubscribe = vi.fn();
  // 既定実装：すべて成功する
  const base: CameraAdapter = {
    id: "test-adapter",
    listDevices: vi.fn(async () => [] as readonly CameraDevice[]),
    getPermission: vi.fn(async () => "granted"),
    requestPermission: vi.fn(async () => "granted"),
    startPreview: vi.fn(async () => previewHandle),
    stopPreview: vi.fn(async () => {}),
    takePicture: vi.fn(async () => photoResult),
    startRecording: vi.fn(async () => recordingHandle),
    stopRecording: vi.fn(async () => recordingResult),
    pauseRecording: vi.fn(async () => {}),
    resumeRecording: vi.fn(async () => {}),
    scanBarcode: vi.fn(async (_h: PreviewHandle, _c: ScannerConfig, _cb) => defaultUnsubscribe),
    dispose: vi.fn(async () => {}),
  };
  // overrides をマージ
  return { ...base, ...overrides };
}

// イベントを集める listener と manager
function setup(overrides: Partial<CameraAdapter> = {}) {
  // 固定時刻
  const now = vi.fn(() => 42);
  // ID は単純連番（manager 内では未使用だが受理する）
  let counter = 0;
  const idFactory = vi.fn(() => `id-${++counter}`);
  // mock adapter
  const adapter = makeAdapter(overrides);
  // manager
  const manager = createCameraManager(adapter, { now, idFactory });
  // events 記録
  const events: CameraEvent[] = [];
  manager.subscribe((e) => events.push(e));
  return { adapter, manager, events, now };
}

describe("createCameraManager basic", () => {
  it("adapterId を露出する", () => {
    const { manager } = setup();
    expect(manager.adapterId).toBe("test-adapter");
  });

  it("listDevices は adapter.listDevices に委譲する", async () => {
    const { adapter, manager } = setup({
      listDevices: vi.fn(async () => [{ id: "d1", label: "Cam" }] as const),
    });
    const list = await manager.listDevices();
    expect(adapter.listDevices).toHaveBeenCalled();
    expect(list).toEqual([{ id: "d1", label: "Cam" }]);
  });

  it("getPermission / requestPermission は permission-change を emit する", async () => {
    const desc: PermissionDescriptor = { camera: true };
    const { manager, events } = setup({
      getPermission: vi.fn(async () => "prompt"),
      requestPermission: vi.fn(async () => "granted"),
    });
    await manager.getPermission(desc);
    await manager.requestPermission(desc);
    const types = events.map((e) => e.type);
    expect(types).toContain("permission-change");
    // permission-change が 2 回 emit されている
    expect(events.filter((e) => e.type === "permission-change").length).toBe(2);
  });
});

describe("createCameraManager preview", () => {
  it("startPreview は preview-start を emit しハンドルを返す", async () => {
    const { manager, events } = setup();
    const handle = await manager.startPreview();
    expect(handle).toBe(previewHandle);
    expect(manager.getPreviewHandle()).toBe(previewHandle);
    expect(events.some((e) => e.type === "preview-start")).toBe(true);
  });

  it("startPreview は既存ハンドルがあれば旧ハンドルを stop して上書きする", async () => {
    const adapter = makeAdapter();
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    await manager.startPreview();
    // adapter.startPreview が 2 回呼ばれている
    expect(adapter.startPreview).toHaveBeenCalledTimes(2);
    // adapter.stopPreview は旧ハンドル分 1 回呼ばれる
    expect(adapter.stopPreview).toHaveBeenCalledTimes(1);
  });

  it("startPreview の旧ハンドル stop が throw しても続行する", async () => {
    const adapter = makeAdapter({
      stopPreview: vi.fn(async () => {
        throw new Error("ignore");
      }),
    });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    await expect(manager.startPreview()).resolves.toBeDefined();
  });

  it("stopPreview は未開始なら no-op", async () => {
    const { adapter, manager } = setup();
    await manager.stopPreview();
    expect(adapter.stopPreview).not.toHaveBeenCalled();
  });

  it("stopPreview はスキャナと録画状態を片付けてから adapter.stopPreview を呼ぶ", async () => {
    const adapterUnsub = vi.fn();
    const adapter = makeAdapter({
      scanBarcode: vi.fn(async () => adapterUnsub),
    });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    await manager.startScanning({ formats: ["qr_code"] }, () => {});
    await manager.startRecording();
    await manager.stopPreview();
    expect(adapterUnsub).toHaveBeenCalled();
    expect(adapter.stopPreview).toHaveBeenCalled();
    expect(manager.getRecordingState()).toBe("idle");
    expect(manager.isScanning()).toBe(false);
  });
});

describe("createCameraManager photo", () => {
  it("preview 未開始の takePicture は CameraNotReadyError", async () => {
    const { manager } = setup();
    await expect(manager.takePicture()).rejects.toBeInstanceOf(CameraNotReadyError);
  });

  it("preview 開始後は adapter.takePicture を呼んで photo イベントを emit", async () => {
    const { adapter, manager, events } = setup();
    await manager.startPreview();
    const result = await manager.takePicture({ quality: 0.9 });
    expect(adapter.takePicture).toHaveBeenCalledWith(previewHandle, { quality: 0.9 });
    expect(result).toBe(photoResult);
    expect(events.some((e) => e.type === "photo")).toBe(true);
  });
});

describe("createCameraManager recording", () => {
  it("preview 未開始の startRecording は CameraNotReadyError", async () => {
    const { manager } = setup();
    await expect(manager.startRecording()).rejects.toBeInstanceOf(CameraNotReadyError);
  });

  it("正常系: start -> pause -> resume -> stop で全イベント emit", async () => {
    const { manager, events } = setup();
    await manager.startPreview();
    const session = await manager.startRecording();
    expect(manager.getRecordingState()).toBe("recording");
    await session.pause();
    expect(session.state).toBe("paused");
    await session.resume();
    expect(session.state).toBe("recording");
    const result = await session.stop();
    expect(result).toBe(recordingResult);
    expect(manager.getRecordingState()).toBe("idle");
    const types = events.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "preview-start",
        "recording-start",
        "recording-pause",
        "recording-resume",
        "recording-stop",
      ]),
    );
  });

  it("既に録画中の startRecording は ALREADY_RECORDING", async () => {
    const { manager } = setup();
    await manager.startPreview();
    await manager.startRecording();
    await expect(manager.startRecording()).rejects.toMatchObject({
      reason: "ALREADY_RECORDING",
    });
  });

  it("session.stop は録画停止後 2 回目で NOT_RECORDING", async () => {
    const { manager } = setup();
    await manager.startPreview();
    const session = await manager.startRecording();
    await session.stop();
    await expect(session.stop()).rejects.toMatchObject({ reason: "NOT_RECORDING" });
  });

  it("session.pause: 未録画では NOT_RECORDING", async () => {
    const { manager } = setup();
    await manager.startPreview();
    const session = await manager.startRecording();
    await session.stop();
    await expect(session.pause()).rejects.toMatchObject({ reason: "NOT_RECORDING" });
  });

  it("session.pause: adapter.pauseRecording 未実装で UNSUPPORTED", async () => {
    const adapter = makeAdapter({ pauseRecording: undefined });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    const session = await manager.startRecording();
    await expect(session.pause()).rejects.toMatchObject({ reason: "UNSUPPORTED" });
  });

  it("session.resume: 一時停止していなければ NOT_PAUSED", async () => {
    const { manager } = setup();
    await manager.startPreview();
    const session = await manager.startRecording();
    await expect(session.resume()).rejects.toMatchObject({ reason: "NOT_PAUSED" });
  });

  it("session.resume: adapter.resumeRecording 未実装で UNSUPPORTED", async () => {
    const adapter = makeAdapter({ resumeRecording: undefined });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    const session = await manager.startRecording();
    await session.pause();
    await expect(session.resume()).rejects.toMatchObject({ reason: "UNSUPPORTED" });
  });
});

describe("createCameraManager scanning", () => {
  it("preview 未開始の startScanning は CameraNotReadyError", async () => {
    const { manager } = setup();
    await expect(
      manager.startScanning({ formats: ["qr_code"] }, () => {}),
    ).rejects.toBeInstanceOf(CameraNotReadyError);
  });

  it("正常系: スキャン結果を onScan に渡し scan イベントを emit", async () => {
    let scannerCb: ((r: BarcodeScanResult) => void) | undefined;
    const unsub = vi.fn();
    const adapter = makeAdapter({
      scanBarcode: vi.fn(async (_h, _c, cb) => {
        scannerCb = cb;
        return unsub;
      }),
    });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    const callback = vi.fn();
    const release = await manager.startScanning({ formats: ["qr_code"] }, callback);
    expect(manager.isScanning()).toBe(true);
    // adapter のコールバックを実行
    scannerCb?.(scanResult);
    expect(callback).toHaveBeenCalledWith(scanResult);
    // unsubscribe
    release();
    expect(unsub).toHaveBeenCalled();
    expect(manager.isScanning()).toBe(false);
  });

  it("既にスキャン中の startScanning は ALREADY_SCANNING", async () => {
    const { manager } = setup();
    await manager.startPreview();
    await manager.startScanning({ formats: ["qr_code"] }, () => {});
    await expect(
      manager.startScanning({ formats: ["qr_code"] }, () => {}),
    ).rejects.toBeInstanceOf(ScannerError);
  });

  it("unsubscribe 二重呼出は安全", async () => {
    const { manager } = setup();
    await manager.startPreview();
    const release = await manager.startScanning({ formats: ["qr_code"] }, () => {});
    release();
    // 2 回目は no-op であって throw しない
    expect(() => release()).not.toThrow();
  });

  it("unsubscribe 関数自体が throw しても解除は完了する", async () => {
    const adapter = makeAdapter({
      scanBarcode: vi.fn(async () =>
        vi.fn(() => {
          throw new Error("bad");
        }),
      ),
    });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    const release = await manager.startScanning({ formats: ["qr_code"] }, () => {});
    expect(() => release()).not.toThrow();
    expect(manager.isScanning()).toBe(false);
  });
});

describe("createCameraManager error events", () => {
  // CameraError 系は error イベント emit
  it("adapter が CameraError 系を投げると error event を emit", async () => {
    const adapter = makeAdapter({
      listDevices: vi.fn(async () => {
        throw new CameraError("boom");
      }),
    });
    const manager = createCameraManager(adapter);
    const events: CameraEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await expect(manager.listDevices()).rejects.toBeInstanceOf(CameraError);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  // 非 CameraError は emit しない
  it("adapter が非 CameraError 例外を投げても error event は emit しない", async () => {
    const adapter = makeAdapter({
      listDevices: vi.fn(async () => {
        throw new Error("plain");
      }),
    });
    const manager = createCameraManager(adapter);
    const events: CameraEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await expect(manager.listDevices()).rejects.toThrow("plain");
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  // PermissionDeniedError などのカスタムエラー
  it("PermissionDeniedError も error event に乗る", async () => {
    const desc: PermissionDescriptor = { camera: true };
    const adapter = makeAdapter({
      requestPermission: vi.fn(async () => {
        throw new PermissionDeniedError(desc);
      }),
    });
    const manager = createCameraManager(adapter);
    const events: CameraEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await expect(manager.requestPermission(desc)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  // RecordingError の rethrow（runAdapter 経由）
  it("adapter.startRecording が RecordingError を投げると error event を emit", async () => {
    const adapter = makeAdapter({
      startRecording: vi.fn(async () => {
        throw new RecordingError("UNSUPPORTED_MIME");
      }),
    });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    const events: CameraEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await expect(manager.startRecording()).rejects.toBeInstanceOf(RecordingError);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });
});

describe("createCameraManager dispose", () => {
  it("dispose 後の各メソッドは CameraNotReadyError", async () => {
    const { manager } = setup();
    await manager.dispose();
    await expect(manager.listDevices()).rejects.toBeInstanceOf(CameraNotReadyError);
    await expect(manager.getPermission({ camera: true })).rejects.toBeInstanceOf(
      CameraNotReadyError,
    );
    await expect(manager.requestPermission({ camera: true })).rejects.toBeInstanceOf(
      CameraNotReadyError,
    );
    await expect(manager.startPreview()).rejects.toBeInstanceOf(CameraNotReadyError);
    await expect(manager.stopPreview()).rejects.toBeInstanceOf(CameraNotReadyError);
    await expect(manager.takePicture()).rejects.toBeInstanceOf(CameraNotReadyError);
    await expect(manager.startRecording()).rejects.toBeInstanceOf(CameraNotReadyError);
    await expect(
      manager.startScanning({ formats: ["qr_code"] }, () => {}),
    ).rejects.toBeInstanceOf(CameraNotReadyError);
  });

  it("二重 dispose は安全", async () => {
    const { adapter, manager } = setup();
    await manager.dispose();
    await manager.dispose();
    // adapter.dispose は最初の 1 回だけ呼ばれる
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
  });

  it("録画中・プレビュー中・スキャン中の状態でも dispose で全て解放する", async () => {
    const adapterUnsub = vi.fn();
    const adapter = makeAdapter({
      scanBarcode: vi.fn(async () => adapterUnsub),
    });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    await manager.startScanning({ formats: ["qr_code"] }, () => {});
    await manager.startRecording();
    await manager.dispose();
    expect(adapter.stopRecording).toHaveBeenCalled();
    expect(adapter.stopPreview).toHaveBeenCalled();
    expect(adapter.dispose).toHaveBeenCalled();
    expect(adapterUnsub).toHaveBeenCalled();
  });

  it("dispose 中の adapter.stopRecording 失敗は無視され続行する", async () => {
    const adapter = makeAdapter({
      stopRecording: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    await manager.startRecording();
    await expect(manager.dispose()).resolves.toBeUndefined();
    expect(adapter.dispose).toHaveBeenCalled();
  });

  it("dispose 中の adapter.stopPreview 失敗は無視され続行する", async () => {
    const adapter = makeAdapter({
      stopPreview: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    await expect(manager.dispose()).resolves.toBeUndefined();
    expect(adapter.dispose).toHaveBeenCalled();
  });

  it("dispose 中の adapter.dispose 失敗は無視される", async () => {
    const adapter = makeAdapter({
      dispose: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    const manager = createCameraManager(adapter);
    await expect(manager.dispose()).resolves.toBeUndefined();
  });
});

describe("createCameraManager subscribe + idFactory default", () => {
  it("subscribe で受け取った unsubscribe で購読解除", async () => {
    const { manager } = setup();
    const listener = vi.fn();
    const unsub = manager.subscribe(listener);
    await manager.startPreview();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsub();
    await manager.stopPreview();
    expect(listener).not.toHaveBeenCalled();
  });

  it("idFactory / now を省略しても動作する（既定実装）", async () => {
    const adapter = makeAdapter();
    const manager = createCameraManager(adapter);
    await expect(manager.startPreview()).resolves.toBe(previewHandle);
    await manager.dispose();
  });
});

// 内部 isCameraErrorLike の各分岐網羅のため、配信側でいろいろな throw を発生させる
describe("createCameraManager runAdapter isCameraErrorLike 分岐", () => {
  it("null を投げる場合は error event 出さない", async () => {
    const adapter = makeAdapter({
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      listDevices: vi.fn(async () => {
        throw null;
      }),
    });
    const manager = createCameraManager(adapter);
    const events: CameraEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await expect(manager.listDevices()).rejects.toBeNull();
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("文字列を投げる場合は error event 出さない", async () => {
    const adapter = makeAdapter({
      listDevices: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "boom";
      }),
    });
    const manager = createCameraManager(adapter);
    const events: CameraEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await expect(manager.listDevices()).rejects.toBe("boom");
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("code のみで retryable が無い object は error event 出さない", async () => {
    const adapter = makeAdapter({
      listDevices: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { code: "only-code", message: "x" };
      }),
    });
    const manager = createCameraManager(adapter);
    const events: CameraEvent[] = [];
    manager.subscribe((e) => events.push(e));
    await expect(manager.listDevices()).rejects.toBeDefined();
    expect(events.some((e) => e.type === "error")).toBe(false);
  });
});

// 起動シーケンス全体の event 順序を beforeEach 込みで検証
describe("createCameraManager イベント順序", () => {
  let manager: ReturnType<typeof setup>["manager"];
  let events: CameraEvent[];

  beforeEach(() => {
    const s = setup();
    manager = s.manager;
    events = s.events;
  });

  it("preview-start -> photo -> preview-stop の順で並ぶ", async () => {
    await manager.startPreview();
    await manager.takePicture();
    await manager.stopPreview();
    const types = events.map((e) => e.type);
    const startIndex = types.indexOf("preview-start");
    const photoIndex = types.indexOf("photo");
    const stopIndex = types.indexOf("preview-stop");
    expect(startIndex).toBeLessThan(photoIndex);
    expect(photoIndex).toBeLessThan(stopIndex);
  });
});
