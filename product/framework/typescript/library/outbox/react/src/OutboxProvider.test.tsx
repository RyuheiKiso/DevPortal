// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// React と test renderer
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
// 対象
import { OutboxProvider } from "./OutboxProvider.js";
import { useOutbox } from "./hooks.js";
// core から型と factory
import {
  createOutboxManager,
  createOutboxStorage,
  type OutboxManager,
} from "@k1s0-ts-outbox/core";

// テスト用の最小 KvStore
function createMemoryKv() {
  // 内部 Map
  const map = new Map<string, unknown>();
  return {
    async get(k: string) { return map.get(k); },
    async set(k: string, v: unknown) { map.set(k, v); },
    async remove(k: string) { map.delete(k); },
  };
}

// 共通: manager を生成するヘルパ
function makeManager(): OutboxManager<unknown> {
  return createOutboxManager({
    storage: createOutboxStorage(createMemoryKv()),
    publisher: async () => {},
    retry: { maxRetries: 0, backoffBaseMs: 1, backoffMaxMs: 10, jitter: "none" },
    scheduler: { intervalMs: 1000, jitterRatio: 0, batchSize: 1, autoStart: false },
  });
}

// 取得した manager を保存するためのプローブコンポーネント
function ManagerProbe({ onManager }: { onManager: (m: OutboxManager<unknown>) => void }) {
  const manager = useOutbox();
  onManager(manager);
  return null;
}

// 各テスト後に追跡しているレンダラをアンマウント
const trackedRenderers: TestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  // 念のため後始末
  while (trackedRenderers.length > 0) {
    const r = trackedRenderers.pop()!;
    act(() => {
      r.unmount();
    });
  }
});

// OutboxProvider の動作
describe("OutboxProvider", () => {
  // JS 経由で両方 undefined のケース (型では弾けない経路)
  it("throws when neither manager nor config is provided", () => {
    expect(() => {
      act(() => {
        TestRenderer.create(
          // @ts-expect-error 故意に props を欠落させて runtime ガードを検証
          <OutboxProvider>
            <div />
          </OutboxProvider>,
        );
      });
    }).toThrow(/requires either `manager` or `config`/);
  });


  // 外部 manager を受け入れる
  it("provides external manager via context", () => {
    // 外部 manager
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
    // 同一参照
    expect(captured).toBe(external);
  });

  // config から内部 manager を生成
  it("creates internal manager from config", () => {
    // 内部 storage / publisher
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
    // 取得できる
    expect(captured).toBeDefined();
  });

  // unmount で内部 manager が dispose される
  it("disposes internal manager on unmount", async () => {
    // mock manager を返す createOutboxManager は使わず、直接外部 manager に dispose スパイを置く
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
    // captured が undefined ではない
    expect(captured).toBeDefined();
    const disposeSpy = vi.spyOn(captured!, "dispose");
    // unmount
    act(() => {
      renderer.unmount();
    });
    // dispose が呼ばれた
    expect(disposeSpy).toHaveBeenCalled();
    // pop しておく (afterEach の二重 unmount を避ける)
    trackedRenderers.pop();
  });

  // 外部 manager が後付けで渡された場合、内部 manager が dispose される
  it("disposes internal manager when external manager appears later", () => {
    // 内部生成からスタート
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
    // 外部 manager をあとから差し替える
    const external = makeManager();
    act(() => {
      renderer.update(
        <OutboxProvider manager={external}>
          <ManagerProbe onManager={(m) => { captured = m; }} />
        </OutboxProvider>,
      );
    });
    // 内部 manager が dispose された
    expect(disposeSpy).toHaveBeenCalled();
    // 取得済みは external
    expect(captured).toBe(external);
  });
});
