// React の hook
import { useCallback, useState } from "react";
// core から型
import type {
  RecordingOptions,
  RecordingResult,
  RecordingSession,
  RecordingState,
} from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";

// useRecording の戻り値
export interface UseRecordingResult {
  // 録画状態
  state: RecordingState;
  // 直近の結果
  lastResult: RecordingResult | undefined;
  // 直近エラー
  error: unknown;
  // 開始
  start: (options?: RecordingOptions) => Promise<RecordingSession | undefined>;
  // 停止
  stop: () => Promise<RecordingResult | undefined>;
  // 一時停止
  pause: () => Promise<void>;
  // 再開
  resume: () => Promise<void>;
}

// 録画 hook
export function useRecording(): UseRecordingResult {
  const manager = useCamera();
  // session（startRecording の戻り値を保持）
  const [session, setSession] = useState<RecordingSession | undefined>(undefined);
  // 状態は session.state を別で観測する形にし、state machine と二重管理しない
  const [state, setState] = useState<RecordingState>("idle");
  const [lastResult, setLastResult] = useState<RecordingResult | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  // start
  const start = useCallback(
    async (options?: RecordingOptions): Promise<RecordingSession | undefined> => {
      setError(undefined);
      try {
        const s = await manager.startRecording(options);
        setSession(s);
        setState("recording");
        return s;
      } catch (err) {
        setError(err);
        return undefined;
      }
    },
    [manager],
  );

  // stop
  const stop = useCallback(async (): Promise<RecordingResult | undefined> => {
    // session が無ければ何もしない
    if (session === undefined) {
      return undefined;
    }
    setError(undefined);
    try {
      const r = await session.stop();
      setLastResult(r);
      setState("idle");
      setSession(undefined);
      return r;
    } catch (err) {
      setError(err);
      return undefined;
    }
  }, [session]);

  // pause
  const pause = useCallback(async (): Promise<void> => {
    // session が無ければ何もしない
    if (session === undefined) {
      return;
    }
    setError(undefined);
    try {
      await session.pause();
      setState("paused");
    } catch (err) {
      setError(err);
    }
  }, [session]);

  // resume
  const resume = useCallback(async (): Promise<void> => {
    if (session === undefined) {
      return;
    }
    setError(undefined);
    try {
      await session.resume();
      setState("recording");
    } catch (err) {
      setError(err);
    }
  }, [session]);

  return { state, lastResult, error, start, stop, pause, resume };
}
