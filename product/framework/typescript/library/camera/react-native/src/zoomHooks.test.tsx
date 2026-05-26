// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useZoom } from "./zoomHooks.js";
// Provider
import { CameraProvider } from "./CameraProvider.js";
// 型
import type {
  CameraCapabilities,
  CameraEvent,
  CameraListener,
  CameraManager,
} from "@k1s0-ts-camera/core";

// zoom 対応 / 非対応
const zoomSupportedCaps: CameraCapabilities = {
  torch: false,
  zoom: { min: 1, max: 10, step: 0.5 },
  focus: false,
  flash: false,
  exposureMode: false,
  whiteBalanceMode: false,
  iso: false,
  brightness: false,
  hdr: false,
  lowLightBoost: false,
};
const zoomUnsupportedCaps: CameraCapabilities = { ...zoomSupportedCaps, zoom: false };

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
    getCapabilities: vi.fn(async () => zoomSupportedCaps),
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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useZoom (RN)", () => {
  it("初期 zoom=1 / supported=false", () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useZoom> | undefined;
    function P() {
      captured = useZoom();
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    expect(captured?.zoom).toBe(1);
    expect(captured?.supported).toBe(false);
  });

  it("preview-start で range 反映 + zoom が range.min に同期", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useZoom> | undefined;
    function P() {
      captured = useZoom();
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
    expect(captured?.range).toEqual({ min: 1, max: 10, step: 0.5 });
    expect(captured?.supported).toBe(true);
    // zoom が range.min (= 1) に同期
    expect(captured?.zoom).toBe(1);
  });

  it("range.min=0.5（expo-camera 相当）で zoom も 0.5 に同期", async () => {
    const expoCaps = {
      ...zoomSupportedCaps,
      zoom: { min: 0.5, max: 1, step: 0.01 },
    };
    const manager = makeManager({ getCapabilities: vi.fn(async () => expoCaps) });
    let captured: ReturnType<typeof useZoom> | undefined;
    function P() {
      captured = useZoom();
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
    expect(captured?.zoom).toBe(0.5);
  });

  it("ユーザ set 後は capabilities 再取得でも zoom が維持される", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useZoom> | undefined;
    function P() {
      captured = useZoom();
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
      await captured?.set(7);
    });
    expect(captured?.zoom).toBe(7);
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-start",
        handle: { __brand: "PreviewHandle", id: "p1", native: null },
        at: 0,
      });
    });
    await flush();
    expect(captured?.zoom).toBe(7);
  });

  it("set() 成功で楽観更新", async () => {
    const setZoom = vi.fn(async () => {});
    const manager = makeManager({ setZoom });
    let captured: ReturnType<typeof useZoom> | undefined;
    function P() {
      captured = useZoom();
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
      await captured?.set(2.5);
    });
    expect(captured?.zoom).toBe(2.5);
  });

  it("set() 失敗で zoom 不変 / error", async () => {
    const err = new Error("z");
    const manager = makeManager({
      setZoom: vi.fn(async () => {
        throw err;
      }),
    });
    let captured: ReturnType<typeof useZoom> | undefined;
    function P() {
      captured = useZoom();
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
      await captured?.set(5);
    });
    expect(captured?.zoom).toBe(1);
    expect(captured?.error).toBe(err);
  });

  it("zoom=false なら supported=false", async () => {
    const manager = makeManager({
      getCapabilities: vi.fn(async () => zoomUnsupportedCaps),
    });
    let captured: ReturnType<typeof useZoom> | undefined;
    function P() {
      captured = useZoom();
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
    expect(captured?.supported).toBe(false);
  });
});
