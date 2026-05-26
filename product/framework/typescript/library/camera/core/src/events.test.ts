// vitest API
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { CameraEventEmitter } from "./events.js";
// イベントの型
import type { CameraEvent } from "./types.js";

// テスト用の固定イベント
function makeEvent(): CameraEvent {
  return {
    type: "preview-start",
    handle: { __brand: "PreviewHandle", id: "h1", native: null },
    at: 1,
  };
}

describe("CameraEventEmitter", () => {
  it("subscribe したリスナにイベントが配信される", () => {
    const emitter = new CameraEventEmitter();
    const listener = vi.fn();
    emitter.subscribe(listener);
    const event = makeEvent();
    emitter.emit(event);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("購読解除後はイベントが届かない", () => {
    const emitter = new CameraEventEmitter();
    const listener = vi.fn();
    const unsub = emitter.subscribe(listener);
    unsub();
    emitter.emit(makeEvent());
    expect(listener).not.toHaveBeenCalled();
  });

  it("listener が throw しても他 listener の配信は止まらない", () => {
    const emitter = new CameraEventEmitter();
    const bad = vi.fn(() => {
      throw new Error("nope");
    });
    const good = vi.fn();
    emitter.subscribe(bad);
    emitter.subscribe(good);
    emitter.emit(makeEvent());
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  it("clear で全 listener を破棄する", () => {
    const emitter = new CameraEventEmitter();
    const listener = vi.fn();
    emitter.subscribe(listener);
    expect(emitter.size()).toBe(1);
    emitter.clear();
    expect(emitter.size()).toBe(0);
    emitter.emit(makeEvent());
    expect(listener).not.toHaveBeenCalled();
  });

  it("size が listener 数を返す", () => {
    const emitter = new CameraEventEmitter();
    expect(emitter.size()).toBe(0);
    emitter.subscribe(() => {});
    emitter.subscribe(() => {});
    expect(emitter.size()).toBe(2);
  });
});
