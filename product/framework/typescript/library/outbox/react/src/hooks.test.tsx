// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React 周辺
import React, { act, useEffect } from "react";
import TestRenderer from "react-test-renderer";
// 対象
import { OutboxProvider } from "./OutboxProvider.js";
import {
  useOutbox,
  useOutboxAppend,
  useOutboxControls,
  useOutboxEntry,
  useOutboxEvents,
  useOutboxList,
  useOutboxStatus,
} from "./hooks.js";
// core
import {
  createOutboxManager,
  createOutboxStorage,
  type OutboxEntry,
  type OutboxEvent,
  type OutboxManager,
} from "@k1s0-ts-outbox/core";

// メモリ KvStore
function createMemoryKv() {
  const map = new Map<string, unknown>();
  return {
    async get(k: string) { return map.get(k); },
    async set(k: string, v: unknown) { map.set(k, v); },
    async remove(k: string) { map.delete(k); },
  };
}
// 共通 manager
function makeManager(): OutboxManager<unknown> {
  return createOutboxManager({
    storage: createOutboxStorage(createMemoryKv()),
    publisher: async () => {},
    retry: { maxRetries: 0, backoffBaseMs: 1, backoffMaxMs: 10, jitter: "none" },
    scheduler: { intervalMs: 1000, jitterRatio: 0, batchSize: 1, autoStart: false },
  });
}

// テスト追跡用
const trackedRenderers: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  while (trackedRenderers.length > 0) {
    const r = trackedRenderers.pop()!;
    act(() => { r.unmount(); });
  }
});

// useOutbox の動作
describe("useOutbox", () => {
  // Provider 不在で throw
  it("throws when used outside provider", () => {
    // テスト用コンポーネント
    function Probe() {
      useOutbox();
      return null;
    }
    // throw すれば成功
    expect(() => {
      act(() => {
        TestRenderer.create(<Probe />);
      });
    }).toThrow(/inside <OutboxProvider>/);
  });
});

// useOutboxList
describe("useOutboxList", () => {
  // scheduler 系イベントでは再フェッチしない (無視リスト経路をカバー)
  it("ignores scheduler-only events", async () => {
    // manager
    const manager = makeManager();
    // list spy
    const listSpy = vi.spyOn(manager, "list");
    function Probe() {
      useOutboxList();
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}>
          <Probe />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    // 初期取得 1 回を消化
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const initialCalls = listSpy.mock.calls.length;
    // start / stop / scheduled イベントだけを発生させる
    act(() => { manager.start(); manager.stop(); });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // list の追加呼び出しはない
    expect(listSpy.mock.calls.length).toBe(initialCalls);
  });

  it("reflects appended entries", async () => {
    // manager
    const manager = makeManager();
    // 観測した list 値
    let captured: readonly OutboxEntry[] = [];
    // テストコンポーネント
    function Probe() {
      const list = useOutboxList();
      captured = list;
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}>
          <Probe />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    // append すると list に反映 (subscribe 経由)
    await act(async () => {
      await manager.append({ payload: { v: 1 } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(captured.length).toBe(1);
  });
});

// useOutboxEntry / useOutboxStatus
describe("useOutboxEntry / useOutboxStatus", () => {
  it("reflects entry changes for the given id only", async () => {
    // manager
    const manager = makeManager();
    // append
    let entryId = "";
    await act(async () => {
      const e = await manager.append({ payload: { v: 1 } });
      entryId = e.id;
    });
    // 観測値
    let captured: OutboxEntry | undefined;
    let capturedStatus: string | undefined;
    function Probe() {
      const entry = useOutboxEntry(entryId);
      const status = useOutboxStatus(entryId);
      captured = entry;
      capturedStatus = status;
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}>
          <Probe />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    // microtask 進める
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(captured?.id).toBe(entryId);
    expect(capturedStatus).toBe("pending");
    // 別の id のイベントは反応しない (manager.append で別 entry を追加)
    const beforeRenderCount = captured?.id;
    await act(async () => {
      await manager.append({ payload: { v: 2 } });
      await new Promise((r) => setTimeout(r, 0));
    });
    // 観測対象は変わらない
    expect(captured?.id).toBe(beforeRenderCount);
  });

  // 同一 id のイベントで再取得され、entry が更新される
  it("refetches entry on matching id event", async () => {
    // manager
    const manager = makeManager();
    let entryId = "";
    await act(async () => {
      const e = await manager.append({ payload: { v: 1 } });
      entryId = e.id;
    });
    // 観測
    let captured: OutboxEntry | undefined;
    function Probe() {
      const entry = useOutboxEntry(entryId);
      captured = entry;
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}>
          <Probe />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    // 初期取得
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // remove で removed イベント (該当 id) → 再取得 (undefined になる)
    await act(async () => {
      await manager.remove(entryId);
      await new Promise((r) => setTimeout(r, 0));
    });
    // entry が undefined になる
    expect(captured).toBeUndefined();
  });

  // entry が undefined のイベント (scheduled / started) で反応しない
  it("ignores events without entry", async () => {
    // manager
    const manager = makeManager();
    let entryId = "";
    await act(async () => {
      const e = await manager.append({ payload: {} });
      entryId = e.id;
    });
    // 取得回数を数える
    const getSpy = vi.spyOn(manager, "get");
    function Probe() {
      const entry = useOutboxEntry(entryId);
      return entry === undefined ? null : null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}>
          <Probe />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    // mount 時の初期 get 1 回
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const calls = getSpy.mock.calls.length;
    // start すると started イベント (entry なし)
    act(() => { manager.start(); });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // get が増えていない (entry なしイベントは無視)
    expect(getSpy.mock.calls.length).toBe(calls);
    // 後始末
    manager.stop();
  });
});

// useOutboxControls
describe("useOutboxControls", () => {
  it("exposes start / stop / flush", async () => {
    // manager
    const manager = makeManager();
    const startSpy = vi.spyOn(manager, "start");
    const stopSpy = vi.spyOn(manager, "stop");
    const flushSpy = vi.spyOn(manager, "flush").mockResolvedValue();
    // テストコンポーネント (effect で呼ぶ)
    function Probe() {
      const { start, stop, flush } = useOutboxControls();
      useEffect(() => {
        start();
        stop();
        void flush();
      }, [start, stop, flush]);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}>
          <Probe />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    // microtask
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(startSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
    expect(flushSpy).toHaveBeenCalled();
  });
});

// useOutboxAppend
describe("useOutboxAppend", () => {
  it("returns a memoized append callback bound to the manager", async () => {
    // manager
    const manager = makeManager();
    const appendSpy = vi.spyOn(manager, "append");
    // テストコンポーネント
    function Probe() {
      const append = useOutboxAppend();
      useEffect(() => {
        void append({ payload: { v: 1 } });
      }, [append]);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}>
          <Probe />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(appendSpy).toHaveBeenCalled();
  });
});

// useOutboxEvents
describe("useOutboxEvents", () => {
  it("subscribes to manager events", async () => {
    const manager = makeManager();
    // listener
    const listener = vi.fn();
    function Probe() {
      useOutboxEvents(listener);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}>
          <Probe />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    // append → listener が呼ばれる
    await act(async () => {
      await manager.append({ payload: {} });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0]![0] as OutboxEvent).toHaveProperty("type");
  });

  // unmount で unsubscribe される
  it("unsubscribes on unmount", async () => {
    const manager = makeManager();
    const listener = vi.fn();
    function Probe() {
      useOutboxEvents(listener);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}>
          <Probe />
        </OutboxProvider>,
      );
    });
    // unmount
    act(() => { renderer.unmount(); });
    // unmount 後の append は listener に到達しない
    await manager.append({ payload: {} });
    await new Promise((r) => setTimeout(r, 0));
    const callsBefore = listener.mock.calls.length;
    await manager.append({ payload: {} });
    expect(listener.mock.calls.length).toBe(callsBefore);
  });
});
