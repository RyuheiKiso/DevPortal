// vitest API
import { describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useCameraPreview } from "./previewHooks.js";
// Provider
import { CameraProvider } from "./CameraProvider.js";
// 型
import type { CameraManager, PreviewHandle } from "@k1s0-ts-camera/core";

// 固定ハンドル
const previewHandle: PreviewHandle = { __brand: "PreviewHandle", id: "p", native: null };

function makeManager(overrides: Partial<CameraManager> = {}): CameraManager {
  return {
    adapterId: "mock",
    listDevices: vi.fn(),
    getPermission: vi.fn(),
    requestPermission: vi.fn(),
    startPreview: vi.fn(async () => previewHandle),
    stopPreview: vi.fn(async () => {}),
    getPreviewHandle: vi.fn(),
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

describe("useCameraPreview (RN)", () => {
  it("正常系: start / stop", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useCameraPreview> | undefined;
    function P() {
      captured = useCameraPreview({ facing: "back" });
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
      const h = await captured?.start();
      expect(h).toBe(previewHandle);
    });
    expect(captured?.handle).toBe(previewHandle);
    await act(async () => {
      await captured?.stop();
    });
    expect(captured?.handle).toBeUndefined();
  });

  it("start error 時に error state へ", async () => {
    const manager = makeManager({
      startPreview: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    let captured: ReturnType<typeof useCameraPreview> | undefined;
    function P() {
      captured = useCameraPreview();
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
      await captured?.start();
    });
    expect((captured?.error as Error).message).toBe("denied");
    expect(captured?.starting).toBe(false);
  });

  it("stop error 時に error state へ", async () => {
    const manager = makeManager({
      stopPreview: vi.fn(async () => {
        throw new Error("stop-err");
      }),
    });
    let captured: ReturnType<typeof useCameraPreview> | undefined;
    function P() {
      captured = useCameraPreview();
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
      await captured?.stop();
    });
    expect((captured?.error as Error).message).toBe("stop-err");
  });

  it("initialConfig と引数 config をマージ", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useCameraPreview> | undefined;
    function P() {
      captured = useCameraPreview({ facing: "front", frameRate: 30 });
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
      await captured?.start({ facing: "back" });
    });
    const call = (manager.startPreview as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.facing).toBe("back");
    expect(call.frameRate).toBe(30);
  });
});
