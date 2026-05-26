// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { CameraProvider } from "./CameraProvider.js";
// hooks
import { useCamera } from "./hooks.js";
// 型
import type { CameraAdapter, CameraManager } from "@k1s0-ts-camera/core";

// adapter mock
function makeAdapter(): CameraAdapter {
  return {
    id: "rn-mock",
    listDevices: vi.fn(async () => []),
    getPermission: vi.fn(async () => "granted"),
    requestPermission: vi.fn(async () => "granted"),
    startPreview: vi.fn(async () => ({ __brand: "PreviewHandle", id: "p", native: null })),
    stopPreview: vi.fn(async () => {}),
    takePicture: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    scanBarcode: vi.fn(),
    dispose: vi.fn(async () => {}),
  };
}

// manager mock
function makeManager(): CameraManager {
  return {
    adapterId: "external",
    listDevices: vi.fn(),
    getPermission: vi.fn(),
    requestPermission: vi.fn(),
    startPreview: vi.fn(),
    stopPreview: vi.fn(),
    getPreviewHandle: vi.fn(),
    takePicture: vi.fn(),
    startRecording: vi.fn(),
    getRecordingState: vi.fn(() => "idle"),
    startScanning: vi.fn(),
    isScanning: vi.fn(() => false),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(async () => {}),
  } as unknown as CameraManager;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Probe で manager を捕捉
function Probe(props: { onValue: (m: CameraManager) => void }) {
  props.onValue(useCamera());
  return null;
}

describe("CameraProvider (react-native)", () => {
  it("adapter prop から内部 manager を生成し、unmount で dispose", async () => {
    const adapter = makeAdapter();
    const captured = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <CameraProvider adapter={adapter}>
          <Probe onValue={captured} />
        </CameraProvider>,
      );
    });
    expect(captured).toHaveBeenCalled();
    act(() => {
      renderer?.unmount();
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter.dispose).toHaveBeenCalled();
  });

  it("外部 manager 指定で adapter は使われない", () => {
    const manager = makeManager();
    const captured = vi.fn();
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <Probe onValue={captured} />
        </CameraProvider>,
      );
    });
    expect(captured).toHaveBeenCalledWith(manager);
  });

  it("外部 manager は Provider unmount で dispose されない", () => {
    const manager = makeManager();
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <CameraProvider manager={manager}>
          <Probe onValue={() => {}} />
        </CameraProvider>,
      );
    });
    act(() => {
      renderer?.unmount();
    });
    expect(manager.dispose).not.toHaveBeenCalled();
  });

  it("Provider 不在で useCamera は throw する", () => {
    expect(() => {
      act(() => {
        TestRenderer.create(<Probe onValue={() => {}} />);
      });
    }).toThrow(/must be called inside/);
  });
});
