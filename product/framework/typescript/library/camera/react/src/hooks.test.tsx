// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import {
  useCamera,
  useCameraDevices,
  useCameraEvents,
  useCameraPermission,
} from "./hooks.js";
// Provider 経由で Context を提供
import { CameraProvider } from "./CameraProvider.js";
// 型
import type { CameraDevice, CameraEvent, CameraManager } from "@k1s0-ts-camera/core";

// 共通: テスト用 manager mock
function makeManager(overrides: Partial<CameraManager> = {}): CameraManager {
  return {
    adapterId: "mock",
    listDevices: vi.fn(async () => [{ id: "v1", label: "Cam" }] as readonly CameraDevice[]),
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
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(async () => {}),
    ...overrides,
  } as unknown as CameraManager;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCamera", () => {
  it("Context から manager を取り出す", () => {
    const manager = makeManager();
    const captured = vi.fn();
    function P() {
      captured(useCamera());
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    expect(captured).toHaveBeenCalledWith(manager);
  });
});

describe("useCameraDevices", () => {
  it("初回マウントで listDevices を呼んで devices を更新する", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useCameraDevices> | undefined;
    function P() {
      captured = useCameraDevices();
      return null;
    }
    await act(async () => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    // microtask フラッシュ
    await act(async () => {
      await Promise.resolve();
    });
    expect(captured?.devices).toEqual([{ id: "v1", label: "Cam" }]);
    expect(captured?.error).toBeUndefined();
  });

  it("listDevices が throw すると error にセット", async () => {
    const manager = makeManager({
      listDevices: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    let captured: ReturnType<typeof useCameraDevices> | undefined;
    function P() {
      captured = useCameraDevices();
      return null;
    }
    await act(async () => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect((captured?.error as Error).message).toBe("boom");
  });

  it("refresh を呼べる", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useCameraDevices> | undefined;
    function P() {
      captured = useCameraDevices();
      return null;
    }
    await act(async () => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    await act(async () => {
      await captured?.refresh();
    });
    expect(manager.listDevices).toHaveBeenCalledTimes(2);
  });
});

describe("useCameraPermission", () => {
  it("初回 refresh が走り status を更新", async () => {
    const manager = makeManager({
      getPermission: vi.fn(async () => "prompt"),
    });
    let captured: ReturnType<typeof useCameraPermission> | undefined;
    function P() {
      captured = useCameraPermission({ camera: true });
      return null;
    }
    await act(async () => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(captured?.status).toBe("prompt");
  });

  it("request を呼ぶと requestPermission が走り status を更新", async () => {
    const manager = makeManager({
      requestPermission: vi.fn(async () => "granted"),
    });
    let captured: ReturnType<typeof useCameraPermission> | undefined;
    function P() {
      captured = useCameraPermission({ camera: true });
      return null;
    }
    await act(async () => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    await act(async () => {
      const s = await captured?.request();
      expect(s).toBe("granted");
    });
    expect(captured?.status).toBe("granted");
  });
});

describe("useCameraEvents", () => {
  it("listener を subscribe し、unmount で解除する", () => {
    const unsub = vi.fn();
    const manager = makeManager({
      subscribe: vi.fn(() => unsub),
    });
    function P() {
      useCameraEvents((_e: CameraEvent) => {});
      return null;
    }
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    expect(manager.subscribe).toHaveBeenCalled();
    act(() => {
      renderer?.unmount();
    });
    expect(unsub).toHaveBeenCalled();
  });

  it("リスナがイベントを受け取る", () => {
    let emitFn: ((e: CameraEvent) => void) | undefined;
    const manager = makeManager({
      subscribe: vi.fn((listener) => {
        emitFn = listener;
        return () => {};
      }),
    });
    const events: CameraEvent[] = [];
    function P() {
      useCameraEvents((e) => events.push(e));
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    emitFn?.({
      type: "preview-start",
      handle: { __brand: "PreviewHandle", id: "p", native: null },
      at: 1,
    });
    expect(events.length).toBe(1);
  });
});
