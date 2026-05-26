// React hook
import { useCallback, useState } from "react";
// core 型
import type {
  RecordingOptions,
  RecordingResult,
  RecordingSession,
  RecordingState,
} from "@k1s0-ts-camera/core";
// manager
import { useCamera } from "./hooks.js";

// 戻り値の型
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

// 録画 hook（React Native 版、ロジックは react 版と同等）
export function useRecording(): UseRecordingResult {
  const manager = useCamera();
  const [session, setSession] = useState<RecordingSession | undefined>(undefined);
  const [state, setState] = useState<RecordingState>("idle");
  const [lastResult, setLastResult] = useState<RecordingResult | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);

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

  const stop = useCallback(async (): Promise<RecordingResult | undefined> => {
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

  const pause = useCallback(async (): Promise<void> => {
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
