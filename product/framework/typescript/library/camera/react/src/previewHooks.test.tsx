// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
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

// manager mock
function makeManager(overrides: Partial<CameraManager> = {}): CameraManager {
  return {
    adapterId: "mock",
    listDevices: vi.fn(async () => []),
    getPermission: vi.fn(async () => "granted" as const),
    requestPermission: vi.fn(async () => "granted" as const),
    startPreview: vi.fn(async () => previewHandle),
    stopPreview: vi.fn(async () => {}),
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

describe("useCameraPreview", () => {
  it("start を呼ぶと manager.startPreview が呼ばれてハンドルが state に入る", async () => {
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
    expect(manager.startPreview).toHaveBeenCalled();
    expect(captured?.handle).toBe(previewHandle);
  });

  it("start: error 時に error state にセット", async () => {
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
      const h = await captured?.start();
      expect(h).toBeUndefined();
    });
    expect((captured?.error as Error).message).toBe("denied");
    expect(captured?.starting).toBe(false);
  });

  it("stop を呼ぶと manager.stopPreview が呼ばれ handle が undefined になる", async () => {
    const manager = makeManager();
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
    await act(async () => {
      await captured?.stop();
    });
    expect(manager.stopPreview).toHaveBeenCalled();
    expect(captured?.handle).toBeUndefined();
  });

  it("stop: error 時に error state にセット", async () => {
    const manager = makeManager({
      stopPreview: vi.fn(async () => {
        throw new Error("oops");
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
    expect((captured?.error as Error).message).toBe("oops");
  });

  it("initialConfig と引数 config をマージする", async () => {
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

  it("引数 config.target が指定されていればそれを優先する", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useCameraPreview> | undefined;
    const customTarget = { foo: "bar" };
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
      await captured?.start({ target: customTarget });
    });
    const call = (manager.startPreview as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.target).toBe(customTarget);
  });

  it("autoStart=true で videoRef が null のまま useEffect が走るケース", () => {
    const manager = makeManager();
    function P() {
      // videoRef は default ref で null のまま
      useCameraPreview({ facing: "back" }, { autoStart: true });
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    // 起動条件を満たさないので startPreview は呼ばれない
    expect(manager.startPreview).not.toHaveBeenCalled();
  });

  it("autoStart=true で videoRef.current が non-null なら自動 start し unmount で停止", async () => {
    const manager = makeManager();
    const fakeElement = { foo: "bar" } as unknown as HTMLVideoElement;
    function P() {
      const r = useCameraPreview({ facing: "back" }, { autoStart: true });
      // ref を render 時に書き換える（useEffect 実行時に反映される）
      r.videoRef.current = fakeElement;
      return null;
    }
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(manager.startPreview).toHaveBeenCalled();
    act(() => {
      renderer?.unmount();
    });
    // cleanup で stopPreview が呼ばれる
    expect(manager.stopPreview).toHaveBeenCalled();
  });
});
