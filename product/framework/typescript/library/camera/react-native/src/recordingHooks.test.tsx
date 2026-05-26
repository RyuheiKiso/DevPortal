// vitest API
import { describe, expect, it, vi } from "vitest";
// React testing helper
import { act } from "react";
import TestRenderer from "react-test-renderer";
// テスト対象
import { useRecording } from "./recordingHooks.js";
// Provider
import { CameraProvider } from "./CameraProvider.js";
// 型
import type { CameraManager, RecordingResult, RecordingSession } from "@k1s0-ts-camera/core";

function makeSession(overrides: Partial<RecordingSession> = {}): RecordingSession {
  return {
    id: "r-1",
    state: "recording",
    stop: vi.fn(async () => ({
      id: "r-1",
      media: { kind: "filePath" as const, path: "/tmp/v.mp4", mimeType: "video/mp4" },
      durationMs: 100,
    })),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    ...overrides,
  };
}

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

describe("useRecording (RN)", () => {
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
      await captured?.start();
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

  it("session 無しでの stop / pause / resume は no-op", async () => {
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

  it("各エラー経路", async () => {
    const session = makeSession({
      stop: vi.fn(async () => {
        throw new Error("stop-err");
      }),
      pause: vi.fn(async () => {
        throw new Error("pause-err");
      }),
      resume: vi.fn(async () => {
        throw new Error("resume-err");
      }),
    });
    const manager = makeManager(session, {
      startRecording: vi.fn(async () => {
        throw new Error("start-err");
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
    // start error
    await act(async () => {
      const s = await captured?.start();
      expect(s).toBeUndefined();
    });
    expect((captured?.error as Error).message).toBe("start-err");
    // 録画開始エラーなので session が無い → stop/pause/resume の error は通らない
    // 別の manager に切り替えて成功 start
    const session2 = makeSession({
      stop: vi.fn(async () => {
        throw new Error("stop-err");
      }),
      pause: vi.fn(async () => {
        throw new Error("pause-err");
      }),
      resume: vi.fn(async () => {
        throw new Error("resume-err");
      }),
    });
    const manager2 = makeManager(session2);
    let captured2: ReturnType<typeof useRecording> | undefined;
    function P2() {
      captured2 = useRecording();
      return null;
    }
    act(() => {
      TestRenderer.create(
        <CameraProvider manager={manager2}>
          <P2 />
        </CameraProvider>,
      );
    });
    await act(async () => {
      await captured2?.start();
    });
    await act(async () => {
      await captured2?.stop();
    });
    expect((captured2?.error as Error).message).toBe("stop-err");
    await act(async () => {
      await captured2?.pause();
    });
    expect((captured2?.error as Error).message).toBe("pause-err");
    await act(async () => {
      await captured2?.resume();
    });
    expect((captured2?.error as Error).message).toBe("resume-err");
  });
});
