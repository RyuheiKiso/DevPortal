// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, useEffect } from "react";
import TestRenderer from "react-test-renderer";
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
import {
  createOutboxManager,
  createOutboxStorage,
  type OutboxEntry,
  type OutboxEvent,
  type OutboxManager,
} from "@k1s0-ts-outbox/core";

function createMemoryKv() {
  const map = new Map<string, unknown>();
  return {
    async get(k: string) { return map.get(k); },
    async set(k: string, v: unknown) { map.set(k, v); },
    async remove(k: string) { map.delete(k); },
  };
}
function makeManager(): OutboxManager<unknown> {
  return createOutboxManager({
    storage: createOutboxStorage(createMemoryKv()),
    publisher: async () => {},
    retry: { maxRetries: 0, backoffBaseMs: 1, backoffMaxMs: 10, jitter: "none" },
    scheduler: { intervalMs: 1000, jitterRatio: 0, batchSize: 1, autoStart: false },
  });
}

const trackedRenderers: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  while (trackedRenderers.length > 0) {
    const r = trackedRenderers.pop()!;
    act(() => { r.unmount(); });
  }
});

// useOutbox
describe("useOutbox (RN)", () => {
  it("throws when used outside provider", () => {
    function Probe() {
      useOutbox();
      return null;
    }
    expect(() => {
      act(() => { TestRenderer.create(<Probe />); });
    }).toThrow(/inside <OutboxProvider>/);
  });
});

// useOutboxList
describe("useOutboxList (RN)", () => {
  it("ignores scheduler events", async () => {
    const manager = makeManager();
    const listSpy = vi.spyOn(manager, "list");
    function Probe() {
      useOutboxList();
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}><Probe /></OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const initial = listSpy.mock.calls.length;
    act(() => { manager.start(); manager.stop(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(listSpy.mock.calls.length).toBe(initial);
  });

  it("reflects appended entries", async () => {
    const manager = makeManager();
    let captured: readonly OutboxEntry[] = [];
    function Probe() {
      const list = useOutboxList();
      captured = list;
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}><Probe /></OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    await act(async () => {
      await manager.append({ payload: { v: 1 } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(captured.length).toBe(1);
  });
});

// useOutboxEntry / useOutboxStatus
describe("useOutboxEntry / useOutboxStatus (RN)", () => {
  it("reflects entry changes for the given id only", async () => {
    const manager = makeManager();
    let entryId = "";
    await act(async () => {
      const e = await manager.append({ payload: { v: 1 } });
      entryId = e.id;
    });
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
        <OutboxProvider manager={manager}><Probe /></OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(captured?.id).toBe(entryId);
    expect(capturedStatus).toBe("pending");
  });

  it("ignores events without entry", async () => {
    const manager = makeManager();
    let entryId = "";
    await act(async () => {
      const e = await manager.append({ payload: {} });
      entryId = e.id;
    });
    const getSpy = vi.spyOn(manager, "get");
    function Probe() {
      useOutboxEntry(entryId);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}><Probe /></OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const initial = getSpy.mock.calls.length;
    act(() => { manager.start(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(getSpy.mock.calls.length).toBe(initial);
    manager.stop();
  });

  it("refetches entry on matching id event", async () => {
    const manager = makeManager();
    let entryId = "";
    await act(async () => {
      const e = await manager.append({ payload: {} });
      entryId = e.id;
    });
    let captured: OutboxEntry | undefined;
    function Probe() {
      const entry = useOutboxEntry(entryId);
      captured = entry;
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}><Probe /></OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      await manager.remove(entryId);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(captured).toBeUndefined();
  });
});

// useOutboxControls
describe("useOutboxControls (RN)", () => {
  it("exposes start / stop / flush", async () => {
    const manager = makeManager();
    const startSpy = vi.spyOn(manager, "start");
    const stopSpy = vi.spyOn(manager, "stop");
    const flushSpy = vi.spyOn(manager, "flush").mockResolvedValue();
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
        <OutboxProvider manager={manager}><Probe /></OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(startSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
    expect(flushSpy).toHaveBeenCalled();
  });
});

// useOutboxAppend
describe("useOutboxAppend (RN)", () => {
  it("returns a memoized append callback", async () => {
    const manager = makeManager();
    const appendSpy = vi.spyOn(manager, "append");
    function Probe() {
      const append = useOutboxAppend();
      useEffect(() => { void append({ payload: {} }); }, [append]);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}><Probe /></OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(appendSpy).toHaveBeenCalled();
  });
});

// useOutboxEvents
describe("useOutboxEvents (RN)", () => {
  it("subscribes to manager events", async () => {
    const manager = makeManager();
    const listener = vi.fn();
    function Probe() {
      useOutboxEvents(listener);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={manager}><Probe /></OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    await act(async () => {
      await manager.append({ payload: {} });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0]![0] as OutboxEvent).toHaveProperty("type");
  });

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
        <OutboxProvider manager={manager}><Probe /></OutboxProvider>,
      );
    });
    act(() => { renderer.unmount(); });
    await manager.append({ payload: {} });
    await new Promise((r) => setTimeout(r, 0));
    const before = listener.mock.calls.length;
    await manager.append({ payload: {} });
    expect(listener.mock.calls.length).toBe(before);
  });
});
