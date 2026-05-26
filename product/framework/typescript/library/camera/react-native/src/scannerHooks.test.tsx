// vitest API
import { describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useBarcodeScanner } from "./scannerHooks.js";
// Provider
import { CameraProvider } from "./CameraProvider.js";
// 型
import type { BarcodeScanResult, CameraManager } from "@k1s0-ts-camera/core";

function makeManager(
  overrides: Partial<CameraManager> = {},
  capture: { cb?: (r: BarcodeScanResult) => void; cancel?: () => void } = {},
): CameraManager {
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

describe("useBarcodeScanner (RN)", () => {
  it("start / 結果蓄積 / historyLimit / stop / 二重 start no-op / start error", async () => {
    const capture: { cb?: (r: BarcodeScanResult) => void; cancel?: () => void } = {};
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
    const onScan = vi.fn();
    await act(async () => {
      await captured?.start(onScan);
    });
    expect(captured?.scanning).toBe(true);
    await act(async () => {
      capture.cb?.({ id: "1", format: "qr_code", value: "a", scannedAt: 0 });
      capture.cb?.({ id: "2", format: "qr_code", value: "b", scannedAt: 0 });
      capture.cb?.({ id: "3", format: "qr_code", value: "c", scannedAt: 0 });
    });
    // historyLimit=2 で先頭が捨てられる
    expect(captured?.results.map((r) => r.id)).toEqual(["2", "3"]);
    expect(onScan).toHaveBeenCalledTimes(3);
    // 二重 start は no-op
    await act(async () => {
      await captured?.start();
    });
    expect(manager.startScanning).toHaveBeenCalledTimes(1);
    act(() => {
      captured?.stop();
    });
    expect(capture.cancel).toHaveBeenCalled();
    expect(captured?.scanning).toBe(false);
  });

  it("start error 時に error state", async () => {
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
  });

  it("stop 何度呼んでも安全", () => {
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
      captured?.stop();
    });
  });

  it("autoStart=true: start 後 unmount で停止", async () => {
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
    await act(async () => {
      await Promise.resolve();
    });
    expect(manager.startScanning).toHaveBeenCalled();
    act(() => {
      renderer?.unmount();
    });
    expect(capture.cancel).toHaveBeenCalled();
  });

  it("autoStart=true: start pending 中 unmount で cleanup no-op", () => {
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
    act(() => {
      renderer?.unmount();
    });
  });
});
