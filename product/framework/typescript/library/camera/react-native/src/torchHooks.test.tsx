// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useTorch } from "./torchHooks.js";
// Provider
import { CameraProvider } from "./CameraProvider.js";
// 型
import type {
  CameraCapabilities,
  CameraEvent,
  CameraListener,
  CameraManager,
} from "@k1s0-ts-camera/core";

// torch 対応 / 非対応の能力情報
const torchSupportedCaps: CameraCapabilities = {
  torch: true,
  zoom: false,
  focus: false,
  flash: true,
  exposureMode: false,
  whiteBalanceMode: false,
  iso: false,
  brightness: false,
  hdr: false,
  lowLightBoost: false,
};
const torchUnsupportedCaps: CameraCapabilities = { ...torchSupportedCaps, torch: false, flash: false };

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
    getCapabilities: vi.fn(async () => torchSupportedCaps),
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

describe("useTorch (RN)", () => {
  it("初期 mode='off'", () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useTorch> | undefined;
    function P() {
      captured = useTorch();
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    expect(captured?.mode).toBe("off");
    expect(captured?.supported).toBe(false);
  });

  it("preview-start で supported=true", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useTorch> | undefined;
    function P() {
      captured = useTorch();
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

  it("set('on') 成功で mode 楽観更新", async () => {
    const setTorch = vi.fn(async () => {});
    const manager = makeManager({ setTorch });
    let captured: ReturnType<typeof useTorch> | undefined;
    function P() {
      captured = useTorch();
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
      await captured?.set("on");
    });
    expect(setTorch).toHaveBeenCalledWith("on");
    expect(captured?.mode).toBe("on");
  });

  it("set 失敗で mode 不変 / error 保持", async () => {
    const err = new Error("torch fail");
    const manager = makeManager({
      setTorch: vi.fn(async () => {
        throw err;
      }),
    });
    let captured: ReturnType<typeof useTorch> | undefined;
    function P() {
      captured = useTorch();
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
      await captured?.set("on");
    });
    expect(captured?.mode).toBe("off");
    expect(captured?.error).toBe(err);
  });

  it("capabilities.torch=false なら supported=false", async () => {
    const manager = makeManager({
      getCapabilities: vi.fn(async () => torchUnsupportedCaps),
    });
    let captured: ReturnType<typeof useTorch> | undefined;
    function P() {
      captured = useTorch();
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
