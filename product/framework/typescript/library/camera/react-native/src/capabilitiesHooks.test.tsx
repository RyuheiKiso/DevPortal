// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useCameraCapabilities } from "./capabilitiesHooks.js";
// Provider
import { CameraProvider } from "./CameraProvider.js";
// 型
import type {
  CameraCapabilities,
  CameraEvent,
  CameraListener,
  CameraManager,
} from "@k1s0-ts-camera/core";

// フル能力情報
const fullCaps: CameraCapabilities = {
  torch: true,
  zoom: { min: 1, max: 5 },
  focus: { tap: true, continuous: true },
  flash: true,
  exposureMode: ["continuous"],
  whiteBalanceMode: ["continuous"],
  iso: { min: 100, max: 1600 },
  brightness: { min: -1, max: 1 },
  hdr: false,
  lowLightBoost: false,
};

// manager mock
function makeManager(overrides: Partial<CameraManager> = {}): CameraManager {
  const listeners = new Set<CameraListener>();
  const subscribe = vi.fn((listener: CameraListener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  const base = {
    adapterId: "mock",
    listDevices: vi.fn(async () => []),
    getPermission: vi.fn(async () => "granted" as const),
    requestPermission: vi.fn(async () => "granted" as const),
    startPreview: vi.fn(),
    stopPreview: vi.fn(),
    getPreviewHandle: vi.fn(() => undefined),
    takePicture: vi.fn(),
    startRecording: vi.fn(),
    getRecordingState: vi.fn(() => "idle" as const),
    startScanning: vi.fn(),
    isScanning: vi.fn(() => false),
    setTorch: vi.fn(async () => {}),
    setZoom: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    getCapabilities: vi.fn(async () => fullCaps),
    subscribe,
    dispose: vi.fn(async () => {}),
  };
  const manager = { ...base, ...overrides } as unknown as CameraManager;
  (manager as { __emit?: (e: CameraEvent) => void }).__emit = (event: CameraEvent) => {
    for (const l of listeners) {
      l(event);
    }
  };
  return manager;
}

// adapter は不要（manager 直接注入のため）
function makeAdapterStub() {
  return {
    id: "stub",
    listDevices: vi.fn(),
    getPermission: vi.fn(),
    requestPermission: vi.fn(),
    startPreview: vi.fn(),
    stopPreview: vi.fn(),
    takePicture: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    scanBarcode: vi.fn(),
    dispose: vi.fn(),
  } as never;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCameraCapabilities (RN)", () => {
  it("初期 undefined", () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useCameraCapabilities> | undefined;
    function P() {
      captured = useCameraCapabilities();
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    expect(captured?.capabilities).toBeUndefined();
  });

  it("refresh() で capabilities が更新される", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useCameraCapabilities> | undefined;
    function P() {
      captured = useCameraCapabilities();
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    await act(async () => {
      await captured?.refresh();
    });
    await flush();
    expect(captured?.capabilities).toEqual(fullCaps);
  });

  it("refresh() 失敗で error を保持", async () => {
    const err = new Error("fail");
    const manager = makeManager({
      getCapabilities: vi.fn(async () => {
        throw err;
      }),
    });
    let captured: ReturnType<typeof useCameraCapabilities> | undefined;
    function P() {
      captured = useCameraCapabilities();
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    let result: CameraCapabilities | undefined;
    await act(async () => {
      result = await captured?.refresh();
    });
    expect(result).toBeUndefined();
    expect(captured?.error).toBe(err);
  });

  it("preview-start で auto-refresh", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useCameraCapabilities> | undefined;
    function P() {
      captured = useCameraCapabilities();
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-start",
        handle: { __brand: "PreviewHandle", id: "p1", native: null },
        at: 0,
      });
    });
    await flush();
    expect(captured?.capabilities).toEqual(fullCaps);
  });

  it("preview-start 以外では refresh されない", async () => {
    const getCapabilities = vi.fn(async () => fullCaps);
    const manager = makeManager({ getCapabilities });
    function P() {
      useCameraCapabilities();
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-stop",
        handleId: "p",
        at: 0,
      });
    });
    await flush();
    expect(getCapabilities).not.toHaveBeenCalled();
  });
});

// makeAdapterStub の未使用警告抑止
void makeAdapterStub;
