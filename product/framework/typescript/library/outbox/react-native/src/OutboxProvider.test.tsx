// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React と test renderer
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
// 対象
import { OutboxProvider } from "./OutboxProvider.js";
import { useOutbox } from "./hooks.js";
// core
import {
  createOutboxManager,
  createOutboxStorage,
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

// プローブ
function ManagerProbe({ onManager }: { onManager: (m: OutboxManager<unknown>) => void }) {
  const manager = useOutbox();
  onManager(manager);
  return null;
}

// テスト後 unmount
const trackedRenderers: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  while (trackedRenderers.length > 0) {
    const r = trackedRenderers.pop()!;
    act(() => { r.unmount(); });
  }
});

// OutboxProvider
describe("OutboxProvider (react-native)", () => {
  // JS 経由で両方 undefined のケース
  it("throws when neither manager nor config is provided", () => {
    expect(() => {
      act(() => {
        TestRenderer.create(
          // @ts-expect-error 故意に props 欠落
          <OutboxProvider>
            <></>
          </OutboxProvider>,
        );
      });
    }).toThrow(/requires either `manager` or `config`/);
  });


  // 外部 manager 受け入れ
  it("provides external manager via context", () => {
    const external = makeManager();
    let captured: OutboxManager<unknown> | undefined;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider manager={external}>
          <ManagerProbe onManager={(m) => { captured = m; }} />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    expect(captured).toBe(external);
  });

  // 内部 manager 生成
  it("creates internal manager from config", () => {
    const storage = createOutboxStorage(createMemoryKv());
    const publisher = vi.fn().mockResolvedValue(undefined);
    let captured: OutboxManager<unknown> | undefined;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider config={{ storage, publisher }}>
          <ManagerProbe onManager={(m) => { captured = m; }} />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    expect(captured).toBeDefined();
  });

  // unmount で内部 dispose
  it("disposes internal manager on unmount", () => {
    const storage = createOutboxStorage(createMemoryKv());
    const publisher = vi.fn().mockResolvedValue(undefined);
    let captured: OutboxManager<unknown> | undefined;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider config={{ storage, publisher }}>
          <ManagerProbe onManager={(m) => { captured = m; }} />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    const disposeSpy = vi.spyOn(captured!, "dispose");
    act(() => { renderer.unmount(); });
    expect(disposeSpy).toHaveBeenCalled();
    trackedRenderers.pop();
  });

  // 外部 manager 後付け
  it("disposes internal when external arrives later", () => {
    const storage = createOutboxStorage(createMemoryKv());
    const publisher = vi.fn().mockResolvedValue(undefined);
    let captured: OutboxManager<unknown> | undefined;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <OutboxProvider config={{ storage, publisher }}>
          <ManagerProbe onManager={(m) => { captured = m; }} />
        </OutboxProvider>,
      );
    });
    trackedRenderers.push(renderer);
    const internalManager = captured!;
    const disposeSpy = vi.spyOn(internalManager, "dispose");
    const external = makeManager();
    act(() => {
      renderer.update(
        <OutboxProvider manager={external}>
          <ManagerProbe onManager={(m) => { captured = m; }} />
        </OutboxProvider>,
      );
    });
    expect(disposeSpy).toHaveBeenCalled();
    expect(captured).toBe(external);
  });
});
