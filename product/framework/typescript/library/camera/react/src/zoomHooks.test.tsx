// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useZoom } from "./zoomHooks.js";
// Provider 経由で Context を提供
import { CameraProvider } from "./CameraProvider.js";
// 型
import type {
  CameraCapabilities,
  CameraEvent,
  CameraListener,
  CameraManager,
} from "@k1s0-ts-camera/core";

// zoom 対応 / 非対応の能力情報
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

describe("useZoom", () => {
  it("初期 zoom=1 / supported=false (capabilities 未取得)", () => {
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
    expect(captured?.range).toBeUndefined();
  });

  it("preview-start で capabilities 取得 -> range が反映 / supported=true / zoom が range.min に同期", async () => {
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
    expect(captured?.supported).toBe(true);
    expect(captured?.range).toEqual({ min: 1, max: 10, step: 0.5 });
    // zoom が range.min (= 1) に同期される
    expect(captured?.zoom).toBe(1);
  });

  it("range.min が 0.5 の場合は zoom も 0.5 に同期", async () => {
    // expo-camera 相当の 0..1 range を模す
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

  it("ユーザ set 後の capabilities 再取得では zoom が維持される", async () => {
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
    // ユーザが set
    await act(async () => {
      await captured?.set(7);
    });
    expect(captured?.zoom).toBe(7);
    // 後から preview-start で capabilities が取れても zoom は 7 のまま（ユーザ意志優先）
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

  it("set() 成功で zoom を楽観更新", async () => {
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
      await captured?.set(3.5);
    });
    expect(setZoom).toHaveBeenCalledWith(3.5);
    expect(captured?.zoom).toBe(3.5);
  });

  it("set() 失敗で zoom 不変 / error 保持", async () => {
    const err = new Error("zoom fail");
    const setZoom = vi.fn(async () => {
      throw err;
    });
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
      await captured?.set(5);
    });
    expect(captured?.zoom).toBe(1);
    expect(captured?.error).toBe(err);
  });

  it("preview-start 以外のイベントは zoomHooks の listener では無視される", async () => {
    // preview-stop イベントを流して reset 経路に入らないことを確認
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
    // preview-stop を emit（zoom リセットは起きない）
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-stop",
        handleId: "p-a",
        at: 0,
      });
    });
    await flush();
    // 初期値の 1 のまま、ユーザも未操作
    expect(captured?.zoom).toBe(1);
  });

  it("別 preview に切り替わったら userSetRef がリセットされ zoom が新 range.min へ同期する", async () => {
    // 2 つの異なる capabilities を順番に返す mock
    const capsA = { ...zoomSupportedCaps, zoom: { min: 1, max: 5 } };
    const capsB = { ...zoomSupportedCaps, zoom: { min: 2, max: 10 } };
    let callCount = 0;
    const manager = makeManager({
      getCapabilities: vi.fn(async () => {
        callCount++;
        // 1 回目: capsA、2 回目以降: capsB
        return callCount === 1 ? capsA : capsB;
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
    // 1 回目の preview-start（カメラ A）
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-start",
        handle: { __brand: "PreviewHandle", id: "p-a", native: null },
        at: 0,
      });
    });
    await flush();
    // capsA.zoom.min = 1 に同期
    expect(captured?.zoom).toBe(1);
    // ユーザが set
    await act(async () => {
      await captured?.set(3);
    });
    expect(captured?.zoom).toBe(3);
    // 2 回目の preview-start（カメラ B、別ハンドル ID）→ userSetRef リセット
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-start",
        handle: { __brand: "PreviewHandle", id: "p-b", native: null },
        at: 1,
      });
    });
    await flush();
    // capsB.zoom.min = 2 に同期される（ユーザ操作前の状態に戻る）
    expect(captured?.zoom).toBe(2);
  });

  it("preview 切替時に range が未取得なら zoom は 1 に fallback する", async () => {
    // getCapabilities を永遠に保留する manager を作り、range が undefined のまま preview-start を流す
    const manager = makeManager({
      getCapabilities: vi.fn(() => new Promise<CameraCapabilities>(() => {})),
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
    // 1 回目の preview-start（range は未取得のまま）
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-start",
        handle: { __brand: "PreviewHandle", id: "p-a", native: null },
        at: 0,
      });
    });
    await flush();
    // ユーザが set
    await act(async () => {
      await captured?.set(4);
    });
    expect(captured?.zoom).toBe(4);
    // 別 preview-start（別ハンドル）→ range 未取得 → 1 fallback
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-start",
        handle: { __brand: "PreviewHandle", id: "p-b", native: null },
        at: 1,
      });
    });
    await flush();
    expect(captured?.zoom).toBe(1);
  });

  it("同一 preview ID で preview-start が複数回来てもユーザ set した zoom は維持される", async () => {
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
    // 1 回目 preview-start（カメラ A）
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-start",
        handle: { __brand: "PreviewHandle", id: "p-a", native: null },
        at: 0,
      });
    });
    await flush();
    // ユーザ set
    await act(async () => {
      await captured?.set(7);
    });
    expect(captured?.zoom).toBe(7);
    // 2 回目 preview-start（同じハンドル ID）→ reset されない
    act(() => {
      (manager as { __emit?: (e: CameraEvent) => void }).__emit?.({
        type: "preview-start",
        handle: { __brand: "PreviewHandle", id: "p-a", native: null },
        at: 1,
      });
    });
    await flush();
    expect(captured?.zoom).toBe(7);
  });

  it("capabilities.zoom=false なら supported=false / range=undefined", async () => {
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
    expect(captured?.range).toBeUndefined();
  });
});
