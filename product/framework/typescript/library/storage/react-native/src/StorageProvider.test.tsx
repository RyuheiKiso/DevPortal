// vitest API を取り込み
import { describe, expect, it } from "vitest";
// React と react-test-renderer
import * as React from "react";
import { act, create } from "react-test-renderer";
// core の Registry / メモリ store
import { createMemoryStore, createStorageRegistry, type StorageRegistry } from "@k1s0-ts-storage/core";
// テスト対象
import { StorageProvider } from "./StorageProvider.js";
import { useStorageRegistry } from "./hooks.js";

// Registry ビルダ
function buildRegistry(): StorageRegistry {
  return createStorageRegistry({
    secure: createMemoryStore<unknown>(),
    durable: createMemoryStore<unknown>(),
    session: createMemoryStore<unknown>(),
    ephemeral: createMemoryStore<unknown>(),
  });
}

// StorageProvider のテスト (react-native binding)
describe("StorageProvider", () => {
  // Provider 配下で useStorageRegistry が registry を返す
  it("provides the registry to descendants", () => {
    const registry = buildRegistry();
    let captured: StorageRegistry | null = null;
    function Probe(): React.JSX.Element {
      captured = useStorageRegistry();
      return <></>;
    }
    act(() => {
      create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    expect(captured).toBe(registry);
  });
  // Provider 外で useStorageRegistry を呼ぶと throw
  it("throws when used outside the provider", () => {
    function Probe(): React.JSX.Element {
      useStorageRegistry();
      return <></>;
    }
    let thrown: unknown;
    try {
      act(() => {
        create(<Probe />);
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
  });
});
