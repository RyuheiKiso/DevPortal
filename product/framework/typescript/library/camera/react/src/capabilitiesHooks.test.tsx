// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useCameraCapabilities } from "./capabilitiesHooks.js";
// Provider 経由で Context を提供
import { CameraProvider } from "./CameraProvider.js";
// 型
import type {
  CameraCapabilities,
  CameraEvent,
  CameraListener,
  CameraManager,
} from "@k1s0-ts-camera/core";

// フル能力情報の参考値
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

// テスト用 manager mock
function makeManager(overrides: Partial<CameraManager> = {}): CameraManager {
  // 購読中の listener セット（preview-start トリガ用）
  const listeners = new Set<CameraListener>();
  // 既定の subscribe 実装（listener を登録し解除関数を返す）
  const defaultSubscribe = vi.fn((listener: CameraListener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  // 既定の getCapabilities（fullCaps を返す）
  const defaultGetCapabilities = vi.fn(async () => fullCaps);
  // ベース manager（必要なメソッドだけ実装、残りは noop）
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
    getCapabilities: defaultGetCapabilities,
    subscribe: defaultSubscribe,
    dispose: vi.fn(async () => {}),
  };
  // override をマージ
  const manager = { ...base, ...overrides } as unknown as CameraManager;
  // emit ヘルパを生やしておく（テストから手動配信する用）
  (manager as { __emit?: (e: CameraEvent) => void }).__emit = (event: CameraEvent) => {
    for (const l of listeners) {
      l(event);
    }
  };
  return manager;
}

// microtask キューを 1 回フラッシュする helper
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCameraCapabilities", () => {
  it("初期状態は capabilities=undefined / loading=false", () => {
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
    expect(captured?.loading).toBe(false);
    expect(captured?.error).toBeUndefined();
  });

  it("refresh() で getCapabilities を呼び capabilities が更新される", async () => {
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
    // refresh 呼び出し
    await act(async () => {
      await captured?.refresh();
    });
    await flush();
    // capabilities が反映される
    expect(captured?.capabilities).toEqual(fullCaps);
    expect(captured?.loading).toBe(false);
    expect(captured?.error).toBeUndefined();
  });

  it("refresh() 失敗時は error を保持し undefined が返る", async () => {
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
    // refresh 戻り値を確認
    let result: CameraCapabilities | undefined;
    await act(async () => {
      result = await captured?.refresh();
    });
    expect(result).toBeUndefined();
    expect(captured?.error).toBe(err);
    expect(captured?.capabilities).toBeUndefined();
  });

  it("preview-start イベントで auto-refresh される", async () => {
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
    // preview-start を手動発火
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-start",
        handle: { __brand: "PreviewHandle", id: "p1", native: null },
        at: 0,
      });
    });
    await flush();
    // capabilities が反映される
    expect(captured?.capabilities).toEqual(fullCaps);
  });

  it("preview-start 以外のイベントでは refresh されない", async () => {
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
    // photo イベントを発火（refresh されない）
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "photo",
        result: {
          id: "p",
          media: { kind: "dataUrl", value: "x", mimeType: "image/jpeg" },
          width: 1,
          height: 1,
          capturedAt: 0,
        },
        at: 0,
      });
    });
    await flush();
    expect(getCapabilities).not.toHaveBeenCalled();
  });
});
