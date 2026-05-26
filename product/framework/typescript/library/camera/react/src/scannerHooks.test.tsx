// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useBarcodeScanner } from "./scannerHooks.js";
// Provider
import { CameraProvider } from "./CameraProvider.js";
// 型
import type { BarcodeScanResult, CameraManager } from "@k1s0-ts-camera/core";

// scan callback を保持し manager.startScanning が解除関数を返す mock
function makeManager(overrides: Partial<CameraManager> = {}, capture: { cb?: (r: BarcodeScanResult) => void; cancel?: () => void } = {}): CameraManager {
  return {
    adapterId: "mock",
    listDevices: vi.fn(),
    getPermission: vi.fn(),
    requestPermission: vi.fn(),
    startPreview: vi.fn(),
    stopPreview: vi.fn(),
    getPreviewHandle: vi.fn(),
    takePicture: vi.fn(),
    startRecording: vi.fn(),
    getRecordingState: vi.fn(() => "idle" as const),
    startScanning: vi.fn(async (_c, cb) => {
      capture.cb = cb;
      const cancel = vi.fn();
      capture.cancel = cancel;
      return cancel;
    }),
    isScanning: vi.fn(() => false),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(async () => {}),
    ...overrides,
  } as unknown as CameraManager;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useBarcodeScanner", () => {
  it("start でスキャン開始し、結果が results に蓄積される", async () => {
    const capture: { cb?: (r: BarcodeScanResult) => void; cancel?: () => void } = {};
    const manager = makeManager({}, capture);
    let captured: ReturnType<typeof useBarcodeScanner> | undefined;
    function P() {
      captured = useBarcodeScanner({ formats: ["qr_code"] });
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager}>
          <P />
        </CameraProvider>,
      );
    });
    const onScan = vi.fn();
    await act(async () => {
      await captured?.start(onScan);
    });
    expect(captured?.scanning).toBe(true);
    // 結果を流す
    await act(async () => {
      capture.cb?.({ id: "s1", format: "qr_code", value: "https://x", scannedAt: 0 });
      capture.cb?.({ id: "s2", format: "qr_code", value: "https://y", scannedAt: 1 });
    });
    expect(captured?.results.length).toBe(2);
    expect(onScan).toHaveBeenCalledTimes(2);
  });

  it("historyLimit を超えると先頭が捨てられる", async () => {
    const capture: { cb?: (r: BarcodeScanResult) => void } = {};
    const manager = makeManager({}, capture);
    let captured: ReturnType<typeof useBarcodeScanner> | undefined;
    function P() {
      captured = useBarcodeScanner({ formats: ["qr_code"] }, { historyLimit: 2 });
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
      await captured?.start();
    });
    await act(async () => {
      capture.cb?.({ id: "1", format: "qr_code", value: "a", scannedAt: 0 });
      capture.cb?.({ id: "2", format: "qr_code", value: "b", scannedAt: 1 });
      capture.cb?.({ id: "3", format: "qr_code", value: "c", scannedAt: 2 });
    });
    expect(captured?.results.map((r) => r.id)).toEqual(["2", "3"]);
  });

  it("start を二重に呼んでも一度だけ", async () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useBarcodeScanner> | undefined;
    function P() {
      captured = useBarcodeScanner({ formats: ["qr_code"] });
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
      await captured?.start();
    });
    await act(async () => {
      await captured?.start();
    });
    expect(manager.startScanning).toHaveBeenCalledTimes(1);
  });

  it("start で error 発生時に error state へ", async () => {
    const manager = makeManager({
      startScanning: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    let captured: ReturnType<typeof useBarcodeScanner> | undefined;
    function P() {
      captured = useBarcodeScanner({ formats: ["qr_code"] });
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
      await captured?.start();
    });
    expect((captured?.error as Error).message).toBe("nope");
    expect(captured?.scanning).toBe(false);
  });

  it("stop で unsubscribe を呼び scanning が false に", async () => {
    const capture: { cancel?: () => void } = {};
    const manager = makeManager({}, capture);
    let captured: ReturnType<typeof useBarcodeScanner> | undefined;
    function P() {
      captured = useBarcodeScanner({ formats: ["qr_code"] });
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
      await captured?.start();
    });
    act(() => {
      captured?.stop();
    });
    expect(capture.cancel).toHaveBeenCalled();
    expect(captured?.scanning).toBe(false);
  });

  it("stop は何度呼んでも安全", () => {
    const manager = makeManager();
    let captured: ReturnType<typeof useBarcodeScanner> | undefined;
    function P() {
      captured = useBarcodeScanner({ formats: ["qr_code"] });
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
      captured?.stop();
    });
    act(() => {
      captured?.stop();
    });
    // 例外が出ないこと
  });

  it("autoStart=true で自動 start し unmount で停止する", async () => {
    const capture: { cancel?: () => void } = {};
    const manager = makeManager({}, capture);
    function P() {
      useBarcodeScanner({ formats: ["qr_code"] }, { autoStart: true });
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
    // start の microtask を消化
    await act(async () => {
      await Promise.resolve();
    });
    expect(manager.startScanning).toHaveBeenCalled();
    act(() => {
      renderer?.unmount();
    });
    expect(capture.cancel).toHaveBeenCalled();
  });

  it("autoStart=true で startScanning が pending のまま unmount すると cleanup は no-op", async () => {
    // resolve しない Promise
    const manager = makeManager({
      startScanning: vi.fn(() => new Promise<never>(() => {})),
    });
    function P() {
      useBarcodeScanner({ formats: ["qr_code"] }, { autoStart: true });
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
    // startScanning は呼ばれたが unsubRef.current はまだ undefined
    expect(manager.startScanning).toHaveBeenCalled();
    // unmount: cleanup 関数の if (unsubRef.current !== undefined) は false
    act(() => {
      renderer?.unmount();
    });
    // 例外が出ないこと
  });
});
