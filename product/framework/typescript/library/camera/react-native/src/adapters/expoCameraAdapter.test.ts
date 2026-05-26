// vitest API
import { describe, expect, it, vi } from "vitest";
// テスト対象
import {
  createExpoCameraAdapter,
  type ExpoCameraPermissionApi,
  type ExpoCameraRef,
} from "./expoCameraAdapter.js";
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

// ref / permissionApi mock
function makeRef(overrides: Partial<ExpoCameraRef> = {}): ExpoCameraRef {
  return {
    takePictureAsync: vi.fn(async () => ({ uri: "file:///tmp/p.jpg", width: 100, height: 200 })),
    recordAsync: vi.fn(async () => ({ uri: "file:///tmp/v.mp4" })),
    stopRecording: vi.fn(),
    ...overrides,
  };
}

function makeApi(overrides: Partial<ExpoCameraPermissionApi> = {}): ExpoCameraPermissionApi {
  return {
    getCameraPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
    requestCameraPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
    getMicrophonePermissionsAsync: vi.fn(async () => ({ status: "granted" })),
    requestMicrophonePermissionsAsync: vi.fn(async () => ({ status: "granted" })),
    getAvailableCameraTypesAsync: vi.fn(async () => ["front", "back", "external", "other"] as const),
    ...overrides,
  };
}

describe("createExpoCameraAdapter", () => {
  it("listDevices: getAvailableCameraTypesAsync 経由", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
    });
    const devices = await adapter.listDevices();
    // 4 種類が CameraDevice にマップされる
    expect(devices.map((d) => d.id)).toEqual(["front", "back", "external", "other"]);
    // facing マッピング（"other" は undefined）
    expect(devices.map((d) => d.facing)).toEqual(["front", "back", "external", undefined]);
  });

  it("listDevices: getAvailableCameraTypesAsync 未実装で空配列", async () => {
    const api = makeApi();
    delete (api as { getAvailableCameraTypesAsync?: unknown }).getAvailableCameraTypesAsync;
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: api,
    });
    await expect(adapter.listDevices()).resolves.toEqual([]);
  });

  it("getPermission: 各種 status マッピング + mic 含む", async () => {
    for (const [input, expected] of [
      ["granted", "granted"],
      ["denied", "blocked"],
      ["undetermined", "prompt"],
      ["unknown", "unavailable"],
    ] as const) {
      const adapter = createExpoCameraAdapter({
        cameraRef: () => makeRef(),
        permissionApi: makeApi({
          getCameraPermissionsAsync: vi.fn(async () => ({ status: input })),
        }),
      });
      await expect(adapter.getPermission({ camera: true })).resolves.toBe(expected);
    }
    // mic が worst の場合
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi({
        getCameraPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
        getMicrophonePermissionsAsync: vi.fn(async () => ({ status: "denied" })),
      }),
    });
    await expect(adapter.getPermission({ camera: true, microphone: true })).resolves.toBe(
      "blocked",
    );
    // mic ありで cam が worst
    const adapter2 = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi({
        getCameraPermissionsAsync: vi.fn(async () => ({ status: "denied" })),
        getMicrophonePermissionsAsync: vi.fn(async () => ({ status: "granted" })),
      }),
    });
    await expect(adapter2.getPermission({ camera: true, microphone: true })).resolves.toBe(
      "blocked",
    );
  });

  it("getPermission: microphone API 未実装でも camera 結果を返す", async () => {
    const api = makeApi();
    delete (api as { getMicrophonePermissionsAsync?: unknown }).getMicrophonePermissionsAsync;
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: api,
    });
    await expect(adapter.getPermission({ camera: true, microphone: true })).resolves.toBe(
      "granted",
    );
  });

  it("requestPermission: cam blocked で PermissionDeniedError", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi({
        requestCameraPermissionsAsync: vi.fn(async () => ({ status: "denied" })),
      }),
    });
    await expect(adapter.requestPermission({ camera: true })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("requestPermission: mic blocked で PermissionDeniedError", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi({
        requestCameraPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
        requestMicrophonePermissionsAsync: vi.fn(async () => ({ status: "denied" })),
      }),
    });
    await expect(
      adapter.requestPermission({ camera: true, microphone: true }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("requestPermission: 両 granted で granted", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
    });
    await expect(adapter.requestPermission({ camera: true, microphone: true })).resolves.toBe(
      "granted",
    );
  });

  it("requestPermission: mic が cam より worst なら mic を返す", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi({
        requestCameraPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
        requestMicrophonePermissionsAsync: vi.fn(async () => ({ status: "undetermined" })),
      }),
    });
    await expect(adapter.requestPermission({ camera: true, microphone: true })).resolves.toBe(
      "prompt",
    );
  });

  it("requestPermission: cam=prompt + mic=granted で worst を返す", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi({
        requestCameraPermissionsAsync: vi.fn(async () => ({ status: "undetermined" })),
        requestMicrophonePermissionsAsync: vi.fn(async () => ({ status: "granted" })),
      }),
    });
    await expect(adapter.requestPermission({ camera: true, microphone: true })).resolves.toBe(
      "prompt",
    );
  });

  it("requestPermission: microphone API 未実装でも camera 結果を返す", async () => {
    const api = makeApi();
    delete (api as { requestMicrophonePermissionsAsync?: unknown }).requestMicrophonePermissionsAsync;
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: api,
    });
    await expect(adapter.requestPermission({ camera: true, microphone: true })).resolves.toBe(
      "granted",
    );
  });

  it("startPreview / stopPreview", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    expect(h.__brand).toBe("PreviewHandle");
    await adapter.stopPreview(h);
    // 不一致ハンドルは no-op
    await adapter.stopPreview({ __brand: "PreviewHandle", id: "x", native: null });
  });

  it("takePicture 正常 / INVALID_HANDLE / REF_UNAVAILABLE", async () => {
    const ref = makeRef();
    const adapter = createExpoCameraAdapter({
      cameraRef: () => ref,
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    const photo = await adapter.takePicture(h, { quality: 0.5, mimeType: "image/png" });
    expect(photo.media).toMatchObject({ kind: "filePath", path: "file:///tmp/p.jpg", mimeType: "image/png" });
    // mimeType 未指定で image/jpeg にフォールバック
    const photo2 = await adapter.takePicture(h);
    expect(photo2.media.mimeType).toBe("image/jpeg");
    // INVALID_HANDLE
    await expect(
      adapter.takePicture({ __brand: "PreviewHandle", id: "x", native: null }),
    ).rejects.toBeInstanceOf(CameraError);
    // REF_UNAVAILABLE
    const adapter2 = createExpoCameraAdapter({
      cameraRef: () => null,
      permissionApi: makeApi(),
    });
    const h2 = await adapter2.startPreview({});
    await expect(adapter2.takePicture(h2)).rejects.toMatchObject({ code: "REF_UNAVAILABLE" });
  });

  it("startRecording 正常 / INVALID_HANDLE / stopRecording 成功", async () => {
    const ref = makeRef();
    const adapter = createExpoCameraAdapter({
      cameraRef: () => ref,
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h, { maxDurationMs: 5000, maxFileSizeBytes: 1000 });
    expect(rec.__brand).toBe("RecordingHandle");
    // recordAsync が resolve していると stopRecording の Promise も resolve
    await new Promise((r) => setTimeout(r, 0));
    const result = await adapter.stopRecording(rec);
    expect(result.media).toMatchObject({ kind: "filePath", path: "file:///tmp/v.mp4" });
    // INVALID_HANDLE
    await expect(
      adapter.startRecording({ __brand: "PreviewHandle", id: "x", native: null }),
    ).rejects.toBeInstanceOf(CameraError);
  });

  it("stopRecording: stopRecording が throw すると RecordingError", async () => {
    const ref = makeRef({
      // ref.stopRecording を throw に
      stopRecording: vi.fn(() => {
        throw new Error("nope");
      }),
      // recordAsync を resolve しないままにする
      recordAsync: vi.fn(() => new Promise<{ uri: string }>(() => {})),
    });
    const adapter = createExpoCameraAdapter({
      cameraRef: () => ref,
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    await expect(adapter.stopRecording(rec)).rejects.toBeInstanceOf(RecordingError);
  });

  it("stopRecording を先に呼んでから recordAsync が解決するケース", async () => {
    // recordAsync を手動制御
    let resolveRec: (v: { uri: string }) => void = () => {};
    const ref = makeRef({
      recordAsync: vi.fn(() => new Promise<{ uri: string }>((r) => {
        resolveRec = r;
      })),
    });
    const adapter = createExpoCameraAdapter({
      cameraRef: () => ref,
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    // stopRecording を先に await ではなく start し、続いて recordAsync を resolve
    const stopP = adapter.stopRecording(rec);
    await new Promise((r) => setTimeout(r, 0));
    resolveRec({ uri: "file:///tmp/v.mp4" });
    const result = await stopP;
    expect(result.media).toMatchObject({ kind: "filePath", path: "file:///tmp/v.mp4" });
  });

  it("stopRecording を先に呼んでから recordAsync が reject するケース", async () => {
    let rejectRec: (err: unknown) => void = () => {};
    const ref = makeRef({
      recordAsync: vi.fn(() => new Promise<{ uri: string }>((_, rej) => {
        rejectRec = rej;
      })),
    });
    const adapter = createExpoCameraAdapter({
      cameraRef: () => ref,
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    const stopP = adapter.stopRecording(rec);
    await new Promise((r) => setTimeout(r, 0));
    rejectRec(new Error("rec fail"));
    await expect(stopP).rejects.toBeDefined();
  });

  it("startRecording: recordAsync が reject すると stopRecording で reject", async () => {
    const ref = makeRef({
      recordAsync: vi.fn(async () => {
        throw new Error("rec fail");
      }),
      stopRecording: vi.fn(() => {}),
    });
    const adapter = createExpoCameraAdapter({
      cameraRef: () => ref,
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    // microtask を進める
    await new Promise((r) => setTimeout(r, 0));
    await expect(adapter.stopRecording(rec)).rejects.toBeDefined();
  });

  it("scanBarcode は UNSUPPORTED_FORMAT", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
    });
    await expect(
      adapter.scanBarcode(
        { __brand: "PreviewHandle", id: "x", native: null },
        { formats: ["qr_code"] },
        () => {},
      ),
    ).rejects.toBeInstanceOf(ScannerError);
  });

  it("録画自然完了で pending に残った結果は次の startRecording 時にクリアされる（H1 リグレッション防止）", async () => {
    // 1 回目の recordAsync を制御
    let resolveRec1: (v: { uri: string }) => void = () => {};
    let resolveRec2: (v: { uri: string }) => void = () => {};
    let call = 0;
    const ref = makeRef({
      recordAsync: vi.fn(
        () =>
          new Promise<{ uri: string }>((resolve) => {
            call++;
            if (call === 1) {
              resolveRec1 = resolve;
            } else {
              resolveRec2 = resolve;
            }
          }),
      ),
    });
    const adapter = createExpoCameraAdapter({
      cameraRef: () => ref,
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    // 1 回目 startRecording → 自然完了 → pending に保存（stopRecording を呼ばない）
    await adapter.startRecording(h);
    resolveRec1({ uri: "file:///tmp/old.mp4" });
    await new Promise((r) => setTimeout(r, 0));
    // 2 回目 startRecording を呼ぶ → 冒頭で pending クリアされるはず
    const rec2 = await adapter.startRecording(h);
    // 2 回目の recordAsync を別 URI で解決
    resolveRec2({ uri: "file:///tmp/new.mp4" });
    await new Promise((r) => setTimeout(r, 0));
    // stopRecording で新セッションの URI が返ること（旧 URI が混入しない）
    const result = await adapter.stopRecording(rec2);
    expect(result.media).toMatchObject({ kind: "filePath", path: "file:///tmp/new.mp4" });
  });

  it("録画自然エラーで pending に残った error も次 startRecording でクリアされる", async () => {
    // 1 回目は reject、2 回目は resolve
    let rejectRec1: (err: unknown) => void = () => {};
    let resolveRec2: (v: { uri: string }) => void = () => {};
    let call = 0;
    const ref = makeRef({
      recordAsync: vi.fn(
        () =>
          new Promise<{ uri: string }>((resolve, reject) => {
            call++;
            if (call === 1) {
              rejectRec1 = reject;
            } else {
              resolveRec2 = resolve;
            }
          }),
      ),
    });
    const adapter = createExpoCameraAdapter({
      cameraRef: () => ref,
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    await adapter.startRecording(h);
    // pending に error を保存
    rejectRec1(new Error("first session failed"));
    await new Promise((r) => setTimeout(r, 0));
    // 2 回目 startRecording で pending error クリア
    const rec2 = await adapter.startRecording(h);
    resolveRec2({ uri: "file:///tmp/fresh.mp4" });
    await new Promise((r) => setTimeout(r, 0));
    // stopRecording は新セッションの URI を成功で返す（旧 error を再送しない）
    const result = await adapter.stopRecording(rec2);
    expect(result.media).toMatchObject({ kind: "filePath", path: "file:///tmp/fresh.mp4" });
  });

  it("dispose で pending result / error がクリアされる（再利用時の残骸防止）", async () => {
    // pending に結果を残した状態で dispose を呼ぶ
    let resolveRec: (v: { uri: string }) => void = () => {};
    const ref = makeRef({
      recordAsync: vi.fn(
        () =>
          new Promise<{ uri: string }>((resolve) => {
            resolveRec = resolve;
          }),
      ),
    });
    const adapter = createExpoCameraAdapter({
      cameraRef: () => ref,
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    await adapter.startRecording(h);
    // recordAsync 解決 → pending に値が積まれる
    resolveRec({ uri: "file:///tmp/stale.mp4" });
    await new Promise((r) => setTimeout(r, 0));
    // dispose で pending がクリアされる（実装の dispose で pendingRecordingResult = undefined となる）
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });

  it("dispose", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
    });
    await adapter.startPreview({});
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});

// controls 注入による capability テスト群
describe("createExpoCameraAdapter controls", () => {
  it("setTorch: 注入ありなら呼ばれる", async () => {
    const setTorch = vi.fn();
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
      controls: { setTorch },
    });
    const h = await adapter.startPreview({});
    await adapter.setTorch!(h, "on");
    expect(setTorch).toHaveBeenCalledWith("on");
  });

  it("setTorch: 注入無しなら UNSUPPORTED", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setTorch!(h, "off")).rejects.toBeInstanceOf(CameraControlError);
  });

  it("setTorch: ハンドル不一致なら CameraError", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
      controls: { setTorch: vi.fn() },
    });
    await adapter.startPreview({});
    const fake: PreviewHandle = { __brand: "PreviewHandle", id: "x", native: null };
    await expect(adapter.setTorch!(fake, "on")).rejects.toBeInstanceOf(CameraError);
  });

  it("setTorch: setter throw を APPLY_FAILED に変換", async () => {
    const err = new Error("boom");
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
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
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
      controls: { setZoom },
    });
    const h = await adapter.startPreview({});
    await adapter.setZoom!(h, 0.4);
    expect(setZoom).toHaveBeenCalledWith(0.4);
  });

  it("setZoom: 注入無しなら UNSUPPORTED", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setZoom!(h, 0.5)).rejects.toMatchObject({ reason: "UNSUPPORTED" });
  });

  it("setZoom: ハンドル不一致なら CameraError", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
      controls: { setZoom: vi.fn() },
    });
    await adapter.startPreview({});
    const fake: PreviewHandle = { __brand: "PreviewHandle", id: "x", native: null };
    await expect(adapter.setZoom!(fake, 0.1)).rejects.toBeInstanceOf(CameraError);
  });

  it("setZoom: setter throw は APPLY_FAILED", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
      controls: {
        setZoom: () => {
          throw new Error("z");
        },
      },
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setZoom!(h, 0.5)).rejects.toMatchObject({ reason: "APPLY_FAILED" });
  });

  it("setFocus: 注入あり、point を渡す", async () => {
    const setFocus = vi.fn();
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
      controls: { setFocus },
    });
    const h = await adapter.startPreview({});
    await adapter.setFocus!(h, { x: 0.2, y: 0.8 });
    expect(setFocus).toHaveBeenCalledWith({ x: 0.2, y: 0.8 });
  });

  it("setFocus: point 無し", async () => {
    const setFocus = vi.fn();
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
      controls: { setFocus },
    });
    const h = await adapter.startPreview({});
    await adapter.setFocus!(h);
    expect(setFocus).toHaveBeenCalledWith(undefined);
  });

  it("setFocus: 注入無しなら UNSUPPORTED", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setFocus!(h)).rejects.toMatchObject({ reason: "UNSUPPORTED" });
  });

  it("setFocus: ハンドル不一致なら CameraError", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
      controls: { setFocus: vi.fn() },
    });
    await adapter.startPreview({});
    const fake: PreviewHandle = { __brand: "PreviewHandle", id: "x", native: null };
    await expect(adapter.setFocus!(fake)).rejects.toBeInstanceOf(CameraError);
  });

  it("setFocus: setter throw は APPLY_FAILED", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
      controls: {
        setFocus: () => {
          throw new Error("f");
        },
      },
    });
    const h = await adapter.startPreview({});
    await expect(adapter.setFocus!(h)).rejects.toMatchObject({ reason: "APPLY_FAILED" });
  });

  it("getCapabilities: フル controls なら全 true 系（zoom range は固定 0..1）", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
      controls: { setTorch: vi.fn(), setZoom: vi.fn(), setFocus: vi.fn() },
    });
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps).toEqual({
      torch: true,
      zoom: { min: 0, max: 1, step: 0.01 },
      focus: { tap: true, continuous: false },
      flash: true,
      exposureMode: false,
      whiteBalanceMode: false,
      iso: false,
      brightness: false,
      hdr: false,
      lowLightBoost: false,
    });
  });

  it("getCapabilities: controls 無しなら全 false 系", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
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

  it("getCapabilities: ハンドル不一致なら CameraError", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
    });
    await adapter.startPreview({});
    const fake: PreviewHandle = { __brand: "PreviewHandle", id: "x", native: null };
    await expect(adapter.getCapabilities!(fake)).rejects.toBeInstanceOf(CameraError);
  });
});
