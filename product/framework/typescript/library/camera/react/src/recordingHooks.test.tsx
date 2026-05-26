// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useRecording } from "./recordingHooks.js";
// Provider
import { CameraProvider } from "./CameraProvider.js";
// 型
import type { CameraManager, RecordingResult, RecordingSession } from "@k1s0-ts-camera/core";

// セッション mock を生成
function makeSession(overrides: Partial<RecordingSession> = {}): RecordingSession {
  const session: RecordingSession = {
    id: "r-1",
    state: "recording",
    stop: vi.fn(async () => ({
      id: "r-1",
      media: { kind: "blob" as const, blob: new Blob([]), mimeType: "video/mp4" },
      durationMs: 1000,
    })),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    ...overrides,
  };
  return session;
}

// manager mock
function makeManager(session: RecordingSession, overrides: Partial<CameraManager> = {}): CameraManager {
  return {
    adapterId: "mock",
    listDevices: vi.fn(),
    getPermission: vi.fn(),
    requestPermission: vi.fn(),
    startPreview: vi.fn(),
    stopPreview: vi.fn(),
    getPreviewHandle: vi.fn(),
    takePicture: vi.fn(),
    startRecording: vi.fn(async () => session),
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

describe("useRecording", () => {
  it("正常系: start -> pause -> resume -> stop", async () => {
    const session = makeSession();
    const manager = makeManager(session);
    let captured: ReturnType<typeof useRecording> | undefined;
    function P() {
      captured = useRecording();
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
      const s = await captured?.start();
      expect(s).toBe(session);
    });
    expect(captured?.state).toBe("recording");
    await act(async () => {
      await captured?.pause();
    });
    expect(captured?.state).toBe("paused");
    await act(async () => {
      await captured?.resume();
    });
    expect(captured?.state).toBe("recording");
    await act(async () => {
      const r = await captured?.stop();
      expect((r as RecordingResult).id).toBe("r-1");
    });
    expect(captured?.state).toBe("idle");
    expect(captured?.lastResult?.id).toBe("r-1");
  });

  it("session 無しで stop / pause / resume は no-op", async () => {
    const session = makeSession();
    const manager = makeManager(session);
    let captured: ReturnType<typeof useRecording> | undefined;
    function P() {
      captured = useRecording();
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
      const r = await captured?.stop();
      expect(r).toBeUndefined();
    });
    await act(async () => {
      await captured?.pause();
    });
    await act(async () => {
      await captured?.resume();
    });
    expect(session.stop).not.toHaveBeenCalled();
  });

  it("start で error が起きると error state へ", async () => {
    const session = makeSession();
    const manager = makeManager(session, {
      startRecording: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    let captured: ReturnType<typeof useRecording> | undefined;
    function P() {
      captured = useRecording();
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
      const s = await captured?.start();
      expect(s).toBeUndefined();
    });
    expect((captured?.error as Error).message).toBe("nope");
  });

  it("stop で error が起きると error state へ", async () => {
    const session = makeSession({
      stop: vi.fn(async () => {
        throw new Error("stop-err");
      }),
    });
    const manager = makeManager(session);
    let captured: ReturnType<typeof useRecording> | undefined;
    function P() {
      captured = useRecording();
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
      const r = await captured?.stop();
      expect(r).toBeUndefined();
    });
    expect((captured?.error as Error).message).toBe("stop-err");
  });

  it("pause / resume で error が起きると error state へ", async () => {
    const session = makeSession({
      pause: vi.fn(async () => {
        throw new Error("pause-err");
      }),
      resume: vi.fn(async () => {
        throw new Error("resume-err");
      }),
    });
    const manager = makeManager(session);
    let captured: ReturnType<typeof useRecording> | undefined;
    function P() {
      captured = useRecording();
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
      await captured?.pause();
    });
    expect((captured?.error as Error).message).toBe("pause-err");
    await act(async () => {
      await captured?.resume();
    });
    expect((captured?.error as Error).message).toBe("resume-err");
  });
});
