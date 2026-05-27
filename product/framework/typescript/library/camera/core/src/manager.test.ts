// vitest API
import { beforeEach, describe, expect, it, vi } from "vitest";
// テスト対象
import { createCameraManager } from "./manager.js";
// 型・エラー
import type { CameraAdapter } from "./adapter.js";
import {
  CameraControlError,
  CameraError,
  CameraNotReadyError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
} from "./errors.js";
import type {
  BarcodeScanResult,
  CameraCapabilities,
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

// 期待される完全対応 capabilities（adapter 実装あり時の戻り値テスト用）
const fullCapabilities: CameraCapabilities = {
  // トーチ対応
  torch: true,
  // ズーム対応（1〜10 倍、step 0.1）
  zoom: { min: 1, max: 10, step: 0.1 },
  // フォーカス対応
  focus: { tap: true, continuous: true },
  // フラッシュ対応
  flash: true,
  // 露出モード一覧
  exposureMode: ["continuous", "manual"],
  // ホワイトバランス一覧
  whiteBalanceMode: ["continuous", "manual"],
  // ISO 範囲
  iso: { min: 100, max: 3200 },
  // 明度範囲
  brightness: { min: -1, max: 1, step: 0.1 },
  // HDR 対応
  hdr: true,
  // 低照度ブースト対応
  lowLightBoost: true,
};

// setTorch のテスト群
describe("CameraManager.setTorch", () => {
  it("プレビュー開始済みなら adapter.setTorch を呼ぶ", async () => {
    // adapter に setTorch を実装した setup を作る
    const setTorch = vi.fn(async () => {});
    const { manager } = setup({ setTorch });
    // プレビューを開始
    await manager.startPreview();
    // setTorch を呼ぶ
    await manager.setTorch("on");
    // adapter に handle + mode が渡る
    expect(setTorch).toHaveBeenCalledWith(previewHandle, "on");
  });

  it("adapter 未実装なら CameraControlError(UNSUPPORTED) を投げる", async () => {
    // adapter.setTorch を持たない setup
    const { manager } = setup();
    await manager.startPreview();
    // UNSUPPORTED の reason で投げられること
    await expect(manager.setTorch("on")).rejects.toBeInstanceOf(CameraControlError);
    await expect(manager.setTorch("on")).rejects.toMatchObject({
      reason: "UNSUPPORTED",
    });
  });

  it("プレビュー未開始なら CameraNotReadyError を投げる", async () => {
    // setTorch 実装あり
    const setTorch = vi.fn(async () => {});
    const { manager } = setup({ setTorch });
    // preview 未開始のまま呼ぶ
    await expect(manager.setTorch("on")).rejects.toBeInstanceOf(CameraNotReadyError);
    // adapter は呼ばれない
    expect(setTorch).not.toHaveBeenCalled();
  });

  it("dispose 後は CameraNotReadyError を投げる", async () => {
    const setTorch = vi.fn(async () => {});
    const { manager } = setup({ setTorch });
    await manager.startPreview();
    await manager.dispose();
    // dispose 後は ensureNotDisposed の CameraNotReadyError が出る
    await expect(manager.setTorch("on")).rejects.toBeInstanceOf(CameraNotReadyError);
  });

  it("adapter が throw した場合は error event を emit して rethrow", async () => {
    // 失敗する adapter
    const err = new CameraControlError("APPLY_FAILED");
    const setTorch = vi.fn(async () => {
      throw err;
    });
    const { manager, events } = setup({ setTorch });
    await manager.startPreview();
    // rethrow されること
    await expect(manager.setTorch("on")).rejects.toBe(err);
    // error event が emit されていること
    expect(events.some((e) => e.type === "error" && e.error === err)).toBe(true);
  });
});

// setZoom のテスト群
describe("CameraManager.setZoom", () => {
  it("プレビュー開始済みなら adapter.setZoom を呼ぶ", async () => {
    const setZoom = vi.fn(async () => {});
    const { manager } = setup({ setZoom });
    await manager.startPreview();
    await manager.setZoom(2.5);
    expect(setZoom).toHaveBeenCalledWith(previewHandle, 2.5);
  });

  it("adapter 未実装なら CameraControlError(UNSUPPORTED) を投げる", async () => {
    const { manager } = setup();
    await manager.startPreview();
    await expect(manager.setZoom(2)).rejects.toMatchObject({
      reason: "UNSUPPORTED",
    });
  });

  it("プレビュー未開始なら CameraNotReadyError を投げる", async () => {
    const setZoom = vi.fn(async () => {});
    const { manager } = setup({ setZoom });
    await expect(manager.setZoom(2)).rejects.toBeInstanceOf(CameraNotReadyError);
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("dispose 後は CameraNotReadyError を投げる", async () => {
    const setZoom = vi.fn(async () => {});
    const { manager } = setup({ setZoom });
    await manager.startPreview();
    await manager.dispose();
    await expect(manager.setZoom(2)).rejects.toBeInstanceOf(CameraNotReadyError);
  });

  it("adapter が OUT_OF_RANGE を投げると同じエラーを rethrow し event 化", async () => {
    const err = new CameraControlError("OUT_OF_RANGE");
    const setZoom = vi.fn(async () => {
      throw err;
    });
    const { manager, events } = setup({ setZoom });
    await manager.startPreview();
    await expect(manager.setZoom(100)).rejects.toBe(err);
    expect(events.some((e) => e.type === "error" && e.error === err)).toBe(true);
  });
});

// setFocus のテスト群
describe("CameraManager.setFocus", () => {
  it("point ありで adapter.setFocus を呼ぶ", async () => {
    const setFocus = vi.fn(async () => {});
    const { manager } = setup({ setFocus });
    await manager.startPreview();
    // タップフォーカス
    await manager.setFocus({ x: 0.5, y: 0.5 });
    expect(setFocus).toHaveBeenCalledWith(previewHandle, { x: 0.5, y: 0.5 });
  });

  it("point なしで adapter.setFocus(undefined) を呼ぶ", async () => {
    const setFocus = vi.fn(async () => {});
    const { manager } = setup({ setFocus });
    await manager.startPreview();
    // 連続 AF へ戻す
    await manager.setFocus();
    expect(setFocus).toHaveBeenCalledWith(previewHandle, undefined);
  });

  it("adapter 未実装なら CameraControlError(UNSUPPORTED) を投げる", async () => {
    const { manager } = setup();
    await manager.startPreview();
    await expect(manager.setFocus({ x: 0.5, y: 0.5 })).rejects.toMatchObject({
      reason: "UNSUPPORTED",
    });
  });

  it("プレビュー未開始なら CameraNotReadyError を投げる", async () => {
    const setFocus = vi.fn(async () => {});
    const { manager } = setup({ setFocus });
    await expect(manager.setFocus({ x: 0.1, y: 0.2 })).rejects.toBeInstanceOf(
      CameraNotReadyError,
    );
    expect(setFocus).not.toHaveBeenCalled();
  });

  it("dispose 後は CameraNotReadyError を投げる", async () => {
    const setFocus = vi.fn(async () => {});
    const { manager } = setup({ setFocus });
    await manager.startPreview();
    await manager.dispose();
    await expect(manager.setFocus()).rejects.toBeInstanceOf(CameraNotReadyError);
  });

  it("x < 0 なら OUT_OF_RANGE で reject（adapter は呼ばれない）", async () => {
    const setFocus = vi.fn(async () => {});
    const { manager } = setup({ setFocus });
    await manager.startPreview();
    // 規約違反値（負数）
    await expect(manager.setFocus({ x: -0.1, y: 0.5 })).rejects.toMatchObject({
      reason: "OUT_OF_RANGE",
    });
    expect(setFocus).not.toHaveBeenCalled();
  });

  it("x > 1 なら OUT_OF_RANGE で reject", async () => {
    const setFocus = vi.fn(async () => {});
    const { manager } = setup({ setFocus });
    await manager.startPreview();
    await expect(manager.setFocus({ x: 1.5, y: 0.5 })).rejects.toMatchObject({
      reason: "OUT_OF_RANGE",
    });
    expect(setFocus).not.toHaveBeenCalled();
  });

  it("y < 0 なら OUT_OF_RANGE で reject", async () => {
    const setFocus = vi.fn(async () => {});
    const { manager } = setup({ setFocus });
    await manager.startPreview();
    await expect(manager.setFocus({ x: 0.5, y: -0.01 })).rejects.toMatchObject({
      reason: "OUT_OF_RANGE",
    });
    expect(setFocus).not.toHaveBeenCalled();
  });

  it("y > 1 なら OUT_OF_RANGE で reject", async () => {
    const setFocus = vi.fn(async () => {});
    const { manager } = setup({ setFocus });
    await manager.startPreview();
    await expect(manager.setFocus({ x: 0.5, y: 1.01 })).rejects.toMatchObject({
      reason: "OUT_OF_RANGE",
    });
    expect(setFocus).not.toHaveBeenCalled();
  });

  it("NaN は OUT_OF_RANGE として弾かれる", async () => {
    const setFocus = vi.fn(async () => {});
    const { manager } = setup({ setFocus });
    await manager.startPreview();
    await expect(manager.setFocus({ x: Number.NaN, y: 0.5 })).rejects.toMatchObject({
      reason: "OUT_OF_RANGE",
    });
  });

  it("境界値 {x:0,y:0} と {x:1,y:1} は成功", async () => {
    const setFocus = vi.fn(async () => {});
    const { manager } = setup({ setFocus });
    await manager.startPreview();
    // 最小境界
    await manager.setFocus({ x: 0, y: 0 });
    // 最大境界
    await manager.setFocus({ x: 1, y: 1 });
    expect(setFocus).toHaveBeenCalledTimes(2);
    expect(setFocus).toHaveBeenNthCalledWith(1, previewHandle, { x: 0, y: 0 });
    expect(setFocus).toHaveBeenNthCalledWith(2, previewHandle, { x: 1, y: 1 });
  });
});

// getCapabilities のテスト群
describe("CameraManager.getCapabilities", () => {
  it("adapter 実装ありなら adapter.getCapabilities を呼んで結果を返す", async () => {
    const getCapabilities = vi.fn(async () => fullCapabilities);
    const { manager } = setup({ getCapabilities });
    await manager.startPreview();
    const caps = await manager.getCapabilities();
    expect(getCapabilities).toHaveBeenCalledWith(previewHandle);
    expect(caps).toEqual(fullCapabilities);
  });

  it("adapter 未実装なら全 false のフォールバックを返す", async () => {
    const { manager } = setup();
    await manager.startPreview();
    const caps = await manager.getCapabilities();
    // すべてのフィールドが false 系の値
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

  it("プレビュー未開始なら CameraNotReadyError を投げる", async () => {
    const getCapabilities = vi.fn(async () => fullCapabilities);
    const { manager } = setup({ getCapabilities });
    await expect(manager.getCapabilities()).rejects.toBeInstanceOf(CameraNotReadyError);
    expect(getCapabilities).not.toHaveBeenCalled();
  });

  it("dispose 後は CameraNotReadyError を投げる", async () => {
    const getCapabilities = vi.fn(async () => fullCapabilities);
    const { manager } = setup({ getCapabilities });
    await manager.startPreview();
    await manager.dispose();
    await expect(manager.getCapabilities()).rejects.toBeInstanceOf(CameraNotReadyError);
  });

  it("adapter が throw した場合は error event を emit して rethrow", async () => {
    const err = new CameraControlError("APPLY_FAILED");
    const getCapabilities = vi.fn(async () => {
      throw err;
    });
    const { manager, events } = setup({ getCapabilities });
    await manager.startPreview();
    await expect(manager.getCapabilities()).rejects.toBe(err);
    expect(events.some((e) => e.type === "error" && e.error === err)).toBe(true);
  });
});

// dispose と start* の race を検証する
// adapter の Promise を保留してから dispose を割り込ませ、await 後の disposed ガードが
// 取得済みハンドルを解放しているかを確認する
describe("createCameraManager dispose race condition", () => {
  it("startPreview の await 中に dispose されたら handle を解放して CameraNotReadyError", async () => {
    // adapter.startPreview を resolver で手動制御する
    let resolvePreview: (h: PreviewHandle) => void = () => {};
    const startPromise = new Promise<PreviewHandle>((res) => {
      resolvePreview = res;
    });
    // 制御可能な adapter を作成
    const adapter = makeAdapter({
      startPreview: vi.fn(async () => startPromise),
    });
    const manager = createCameraManager(adapter);
    // startPreview を呼ぶが await はせず Promise だけ受け取る
    const startP = manager.startPreview();
    // dispose を割り込ませる（先に disposed=true になる）
    await manager.dispose();
    // 保留していた adapter.startPreview をここで解決
    resolvePreview(previewHandle);
    // race 後の startPreview 呼出は CameraNotReadyError で reject される
    await expect(startP).rejects.toBeInstanceOf(CameraNotReadyError);
    // 内部状態にもハンドルが残っていない
    expect(manager.getPreviewHandle()).toBeUndefined();
    // adapter.stopPreview が race 後の解放経路で呼ばれていること
    expect(adapter.stopPreview).toHaveBeenCalledWith(previewHandle);
  });

  it("startPreview の race 解放時に adapter.stopPreview が throw しても CameraNotReadyError", async () => {
    // adapter.startPreview を遅延させ、stopPreview は throw に
    let resolvePreview: (h: PreviewHandle) => void = () => {};
    const startPromise = new Promise<PreviewHandle>((res) => {
      resolvePreview = res;
    });
    const adapter = makeAdapter({
      startPreview: vi.fn(async () => startPromise),
      stopPreview: vi.fn(async () => {
        throw new Error("stop fail");
      }),
    });
    const manager = createCameraManager(adapter);
    const startP = manager.startPreview();
    await manager.dispose();
    resolvePreview(previewHandle);
    // 解放 throw は無視され、CameraNotReadyError が返ること
    await expect(startP).rejects.toBeInstanceOf(CameraNotReadyError);
  });

  it("startRecording の await 中に dispose されたら recording を解放して CameraNotReadyError", async () => {
    // adapter.startRecording を resolver で手動制御
    let resolveStart: (h: RecordingHandle) => void = () => {};
    const startPromise = new Promise<RecordingHandle>((res) => {
      resolveStart = res;
    });
    // 制御可能な adapter
    const adapter = makeAdapter({
      startRecording: vi.fn(async () => startPromise),
    });
    const manager = createCameraManager(adapter);
    // 事前にプレビューを開始しておく
    await manager.startPreview();
    // startRecording を呼ぶが await しない
    const startP = manager.startRecording();
    // dispose を割り込ませる
    await manager.dispose();
    // 録画開始 Promise をここで解決
    resolveStart(recordingHandle);
    // race 後の startRecording 呼出は CameraNotReadyError
    await expect(startP).rejects.toBeInstanceOf(CameraNotReadyError);
    // 状態は idle に戻っている
    expect(manager.getRecordingState()).toBe("idle");
    // adapter.stopRecording が race 後の解放経路で呼ばれる
    expect(adapter.stopRecording).toHaveBeenCalledWith(recordingHandle);
  });

  it("startRecording の race 解放時に adapter.stopRecording が throw しても CameraNotReadyError", async () => {
    // adapter.startRecording を遅延、stopRecording は throw
    let resolveStart: (h: RecordingHandle) => void = () => {};
    const startPromise = new Promise<RecordingHandle>((res) => {
      resolveStart = res;
    });
    const adapter = makeAdapter({
      startRecording: vi.fn(async () => startPromise),
      stopRecording: vi.fn(async () => {
        throw new Error("stop fail");
      }),
    });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    const startP = manager.startRecording();
    await manager.dispose();
    resolveStart(recordingHandle);
    // 解放 throw は無視され CameraNotReadyError が返る
    await expect(startP).rejects.toBeInstanceOf(CameraNotReadyError);
  });

  it("startScanning の await 中に dispose されたら unsubscribe を呼んで CameraNotReadyError", async () => {
    // unsubscribe を spy
    const unsub = vi.fn();
    // adapter.scanBarcode を resolver で手動制御
    let resolveStart: (fn: () => void) => void = () => {};
    const startPromise = new Promise<() => void>((res) => {
      resolveStart = res;
    });
    const adapter = makeAdapter({
      scanBarcode: vi.fn(async () => startPromise),
    });
    const manager = createCameraManager(adapter);
    // 事前にプレビュー
    await manager.startPreview();
    // startScanning を呼ぶが await しない
    const startP = manager.startScanning({ formats: ["qr_code"] }, () => {});
    // dispose を割り込ませる
    await manager.dispose();
    // スキャナ Promise を解決
    resolveStart(unsub);
    // race 後は CameraNotReadyError で reject
    await expect(startP).rejects.toBeInstanceOf(CameraNotReadyError);
    // unsubscribe が race 後に呼ばれている
    expect(unsub).toHaveBeenCalled();
    // 内部スキャン中フラグは false
    expect(manager.isScanning()).toBe(false);
  });

  it("並行 startPreview は in-flight Promise を共有し adapter.startPreview は 1 回だけ呼ばれる", async () => {
    // adapter.startPreview を resolver で手動制御
    let resolvePreview: (h: PreviewHandle) => void = () => {};
    const startPromise = new Promise<PreviewHandle>((res) => {
      resolvePreview = res;
    });
    const startSpy = vi.fn(async () => startPromise);
    const adapter = makeAdapter({ startPreview: startSpy });
    const manager = createCameraManager(adapter);
    // 並行に 2 回呼ぶ
    const p1 = manager.startPreview();
    const p2 = manager.startPreview();
    // Promise は同一参照（in-flight 共有）
    expect(p1).toBe(p2);
    // adapter 解決
    resolvePreview(previewHandle);
    const [h1, h2] = await Promise.all([p1, p2]);
    // 同じ handle が返る
    expect(h1).toBe(previewHandle);
    expect(h2).toBe(previewHandle);
    // adapter.startPreview は 1 回だけ呼ばれる
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("並行 startRecording は in-flight Promise を共有", async () => {
    let resolveStart: (h: RecordingHandle) => void = () => {};
    const startPromise = new Promise<RecordingHandle>((res) => {
      resolveStart = res;
    });
    const startSpy = vi.fn(async () => startPromise);
    const adapter = makeAdapter({ startRecording: startSpy });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    // 並行 2 回
    const p1 = manager.startRecording();
    const p2 = manager.startRecording();
    expect(p1).toBe(p2);
    resolveStart(recordingHandle);
    const [s1, s2] = await Promise.all([p1, p2]);
    // session オブジェクト自体は同一参照（同 Promise が解決した値）
    expect(s1).toBe(s2);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("並行 startScanning は in-flight Promise を共有", async () => {
    // adapter.scanBarcode を resolver 制御
    const unsub = vi.fn();
    let resolveScan: (fn: () => void) => void = () => {};
    const scanPromise = new Promise<() => void>((res) => {
      resolveScan = res;
    });
    const scanSpy = vi.fn(async () => scanPromise);
    const adapter = makeAdapter({ scanBarcode: scanSpy });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    const p1 = manager.startScanning({ formats: ["qr_code"] }, () => {});
    const p2 = manager.startScanning({ formats: ["qr_code"] }, () => {});
    expect(p1).toBe(p2);
    resolveScan(unsub);
    const [u1, u2] = await Promise.all([p1, p2]);
    expect(u1).toBe(u2);
    expect(scanSpy).toHaveBeenCalledTimes(1);
  });

  it("startScanning の race 解放時に unsubscribe が throw しても CameraNotReadyError", async () => {
    // unsubscribe が throw
    const unsub = vi.fn(() => {
      throw new Error("unsub fail");
    });
    let resolveStart: (fn: () => void) => void = () => {};
    const startPromise = new Promise<() => void>((res) => {
      resolveStart = res;
    });
    const adapter = makeAdapter({
      scanBarcode: vi.fn(async () => startPromise),
    });
    const manager = createCameraManager(adapter);
    await manager.startPreview();
    const startP = manager.startScanning({ formats: ["qr_code"] }, () => {});
    await manager.dispose();
    resolveStart(unsub);
    // 解放 throw は無視され CameraNotReadyError が返る
    await expect(startP).rejects.toBeInstanceOf(CameraNotReadyError);
  });
});
