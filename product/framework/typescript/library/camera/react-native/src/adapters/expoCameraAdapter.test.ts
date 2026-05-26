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
  CameraError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
} from "@k1s0-ts-camera/core";

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

  it("dispose", async () => {
    const adapter = createExpoCameraAdapter({
      cameraRef: () => makeRef(),
      permissionApi: makeApi(),
    });
    await adapter.startPreview({});
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});
