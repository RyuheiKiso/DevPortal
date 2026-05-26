// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useFocus } from "./focusHooks.js";
// Provider
import { CameraProvider } from "./CameraProvider.js";
// 型
import type {
  CameraCapabilities,
  CameraEvent,
  CameraListener,
  CameraManager,
} from "@k1s0-ts-camera/core";

// focus 対応 / 非対応
const focusSupportedCaps: CameraCapabilities = {
  torch: false,
  zoom: false,
  focus: { tap: true, continuous: true },
  flash: false,
  exposureMode: false,
  whiteBalanceMode: false,
  iso: false,
  brightness: false,
  hdr: false,
  lowLightBoost: false,
};
const focusUnsupportedCaps: CameraCapabilities = { ...focusSupportedCaps, focus: false };

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
    getCapabilities: vi.fn(async () => focusSupportedCaps),
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

describe("useFocus (RN)", () => {
  it("初期 supported=false", () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useFocus> | undefined;
    function P() {
      captured = useFocus();
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    expect(captured?.supported).toBe(false);
  });

  it("preview-start で supported=true", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useFocus> | undefined;
    function P() {
      captured = useFocus();
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
    expect(captured?.supported).toBe(true);
  });

  it("focus(point) で setFocus 呼ばれる", async () => {
    const setFocus = vi.fn(async () => {});
    const manager = makeManager({ setFocus });
    let captured: ReturnType<typeof useFocus> | undefined;
    function P() {
      captured = useFocus();
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
      await captured?.focus({ x: 0.4, y: 0.6 });
    });
    expect(setFocus).toHaveBeenCalledWith({ x: 0.4, y: 0.6 });
  });

  it("focus() で undefined を渡す", async () => {
    const setFocus = vi.fn(async () => {});
    const manager = makeManager({ setFocus });
    let captured: ReturnType<typeof useFocus> | undefined;
    function P() {
      captured = useFocus();
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
      await captured?.focus();
    });
    expect(setFocus).toHaveBeenCalledWith(undefined);
  });

  it("失敗で error を保持", async () => {
    const err = new Error("f");
    const manager = makeManager({
      setFocus: vi.fn(async () => {
        throw err;
      }),
    });
    let captured: ReturnType<typeof useFocus> | undefined;
    function P() {
      captured = useFocus();
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
      await captured?.focus();
    });
    expect(captured?.error).toBe(err);
  });

  it("capabilities.focus=false なら supported=false", async () => {
    const manager = makeManager({
      getCapabilities: vi.fn(async () => focusUnsupportedCaps),
    });
    let captured: ReturnType<typeof useFocus> | undefined;
    function P() {
      captured = useFocus();
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
