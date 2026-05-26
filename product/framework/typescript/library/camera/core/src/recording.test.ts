// vitest API
import { describe, expect, it } from "vitest";
// テスト対象
import { RecordingStateMachine } from "./recording.js";
// 投げられる例外
import { RecordingError } from "./errors.js";

describe("RecordingStateMachine", () => {
  it("初期状態は idle", () => {
    const sm = new RecordingStateMachine();
    expect(sm.state).toBe("idle");
  });

  it("idle -> recording -> paused -> recording -> idle の正常遷移", () => {
    const sm = new RecordingStateMachine();
    sm.transitionTo("recording");
    expect(sm.state).toBe("recording");
    sm.transitionTo("paused");
    expect(sm.state).toBe("paused");
    sm.transitionTo("recording");
    expect(sm.state).toBe("recording");
    sm.transitionTo("idle");
    expect(sm.state).toBe("idle");
  });

  it("paused から idle へ直接遷移できる", () => {
    const sm = new RecordingStateMachine();
    sm.transitionTo("recording");
    sm.transitionTo("paused");
    sm.transitionTo("idle");
    expect(sm.state).toBe("idle");
  });

  it("同状態への遷移は no-op で例外を投げない", () => {
    const sm = new RecordingStateMachine();
    sm.transitionTo("idle"); // 既に idle
    expect(sm.state).toBe("idle");
  });

  it("不正遷移は RecordingError を投げる", () => {
    const sm = new RecordingStateMachine();
    // idle -> paused は不可
    expect(() => sm.transitionTo("paused")).toThrow(RecordingError);
  });

  it("reset は強制的に idle に戻す", () => {
    const sm = new RecordingStateMachine();
    sm.transitionTo("recording");
    sm.reset();
    expect(sm.state).toBe("idle");
  });
});
