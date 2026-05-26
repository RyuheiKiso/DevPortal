// vitest API
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// React の testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { CameraProvider } from "./CameraProvider.js";
// hooks（Provider 下で利用）
import { useCamera } from "./hooks.js";
// 型
import type { CameraAdapter, CameraManager } from "@k1s0-ts-camera/core";

// 各種テストで使うダミー manager / adapter
function makeManager(overrides: Partial<CameraManager> = {}): CameraManager {
  const noop = vi.fn();
  const base = {
    adapterId: "mock",
    listDevices: vi.fn(async () => []),
    getPermission: vi.fn(async () => "granted" as const),
    requestPermission: vi.fn(async () => "granted" as const),
    startPreview: vi.fn(async () => ({
      __brand: "PreviewHandle" as const,
      id: "p",
      native: null,
    })),
    stopPreview: vi.fn(async () => {}),
    getPreviewHandle: vi.fn(() => undefined),
    takePicture: vi.fn(),
    startRecording: vi.fn(),
    getRecordingState: vi.fn(() => "idle" as const),
    startScanning: vi.fn(),
    isScanning: vi.fn(() => false),
    subscribe: vi.fn(() => noop),
    dispose: vi.fn(async () => {}),
  } as unknown as CameraManager;
  return { ...base, ...overrides };
}

// 簡易 mock adapter（webAdapter の代替）
function makeAdapter(): CameraAdapter {
  return {
    id: "mock",
    listDevices: vi.fn(async () => []),
    getPermission: vi.fn(async () => "granted"),
    requestPermission: vi.fn(async () => "granted"),
    startPreview: vi.fn(async () => ({ __brand: "PreviewHandle", id: "p", native: null })),
    stopPreview: vi.fn(async () => {}),
    takePicture: vi.fn(async () => ({
      id: "ph",
      media: { kind: "blob" as const, blob: new Blob([]), mimeType: "image/jpeg" },
      width: 1,
      height: 1,
      capturedAt: 0,
    })),
    startRecording: vi.fn(async () => ({ __brand: "RecordingHandle", id: "r", native: null })),
    stopRecording: vi.fn(async () => ({
      id: "r",
      media: { kind: "filePath" as const, path: "/tmp", mimeType: "video/mp4" },
      durationMs: 0,
    })),
    scanBarcode: vi.fn(async () => () => {}),
    dispose: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  // React のテスト環境フラグ
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// useCamera の値を捕捉する Probe
function Probe(props: { onValue: (m: CameraManager) => void }) {
  const m = useCamera();
  props.onValue(m);
  return null;
}

describe("CameraProvider", () => {
  it("外部 manager を Context に流す", () => {
    const manager = makeManager();
    const captured = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <CameraProvider manager={manager}>
          <Probe onValue={captured} />
        </CameraProvider>,
      );
    });
    expect(captured).toHaveBeenCalledWith(manager);
    act(() => {
      renderer?.unmount();
    });
    // 外部 manager の dispose は呼ばれない
    expect(manager.dispose).not.toHaveBeenCalled();
  });

  it("adapter prop で内部 manager を生成し、unmount で dispose する", async () => {
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
    // microtask を待つ
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter.dispose).toHaveBeenCalled();
  });

  it("adapter 未指定時は createWebAdapter を使う（navigator stub で確認）", () => {
    // navigator stub があれば内部生成が走る（dispose 含めて副作用が起きない範囲で）
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
        enumerateDevices: vi.fn(async () => []),
      },
    });
    const captured = vi.fn();
    act(() => {
      TestRenderer.create(
        <CameraProvider>
          <Probe onValue={captured} />
        </CameraProvider>,
      );
    });
    // adapterId は "web"（createWebAdapter の既定）
    const m = captured.mock.calls[0][0] as CameraManager;
    expect(m.adapterId).toBe("web");
  });

  it("Provider 不在で useCamera は throw する", () => {
    expect(() => {
      act(() => {
        TestRenderer.create(<Probe onValue={() => {}} />);
      });
    }).toThrow(/must be called inside/);
  });

  it("マウント → アンマウント → 再マウントで毎回有効な manager を返す（strict mode 相当の double mount を模す）", async () => {
    const adapter1 = makeAdapter();
    const adapter2 = makeAdapter();
    const captured1 = vi.fn();
    const captured2 = vi.fn();
    // 1 回目マウント
    let renderer1: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer1 = TestRenderer.create(
        <CameraProvider adapter={adapter1}>
          <Probe onValue={captured1} />
        </CameraProvider>,
      );
    });
    const m1 = captured1.mock.calls[0][0] as CameraManager;
    expect(m1).toBeDefined();
    expect(m1.adapterId).toBe("mock");
    // 1 回目アンマウント（cleanup で dispose）
    act(() => {
      renderer1?.unmount();
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter1.dispose).toHaveBeenCalled();
    // 2 回目マウント（新しい adapter で別 Provider）
    let renderer2: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer2 = TestRenderer.create(
        <CameraProvider adapter={adapter2}>
          <Probe onValue={captured2} />
        </CameraProvider>,
      );
    });
    const m2 = captured2.mock.calls[0][0] as CameraManager;
    // 2 回目に取得した manager は別インスタンス
    expect(m2).toBeDefined();
    expect(m2).not.toBe(m1);
    // adapter2 が dispose されないことを確認（まだ生きている）
    expect(adapter2.dispose).not.toHaveBeenCalled();
    // 2 回目アンマウントで adapter2 が dispose される
    act(() => {
      renderer2?.unmount();
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter2.dispose).toHaveBeenCalled();
  });
});
