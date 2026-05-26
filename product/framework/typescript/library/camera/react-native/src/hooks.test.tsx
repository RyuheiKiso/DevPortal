// vitest API
import { describe, expect, it, vi } from "vitest";
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
// Provider
import { CameraProvider } from "./CameraProvider.js";
// 型
import type { CameraDevice, CameraEvent, CameraManager } from "@k1s0-ts-camera/core";

// manager mock
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

describe("useCamera (RN)", () => {
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

describe("useCameraDevices (RN)", () => {
  it("初回マウントで listDevices を呼ぶ", async () => {
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
      await Promise.resolve();
    });
    expect(captured?.devices).toEqual([{ id: "v1", label: "Cam" }]);
  });

  it("error 時に error state にセット", async () => {
    const manager = makeManager({
      listDevices: vi.fn(async () => {
        throw new Error("nope");
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
    expect((captured?.error as Error).message).toBe("nope");
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

describe("useCameraPermission (RN)", () => {
  it("request で requestPermission を呼び status を granted に更新する", async () => {
    const manager = makeManager({
      getPermission: vi.fn(async () => "prompt"),
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
      await Promise.resolve();
    });
    await act(async () => {
      const s = await captured?.request();
      expect(s).toBe("granted");
    });
    expect(manager.requestPermission).toHaveBeenCalled();
  });
});

describe("useCameraEvents (RN)", () => {
  it("subscribe / unsubscribe", () => {
    const unsub = vi.fn();
    const manager = makeManager({ subscribe: vi.fn(() => unsub) });
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

  it("listener が event を受け取る", () => {
    let emit: ((e: CameraEvent) => void) | undefined;
    const manager = makeManager({
      subscribe: vi.fn((listener) => {
        emit = listener;
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
    emit?.({
      type: "preview-start",
      handle: { __brand: "PreviewHandle", id: "p", native: null },
      at: 0,
    });
    expect(events.length).toBe(1);
  });
});
