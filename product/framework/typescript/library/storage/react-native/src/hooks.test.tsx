// vitest API を取り込み
import { describe, expect, it } from "vitest";
// React と react-test-renderer
import * as React from "react";
import { act, create } from "react-test-renderer";
// core
import {
  createMemoryStore,
  createStorageRegistry,
  createTypedSlot,
  type KvStore,
  type StorageRegistry,
  type TypedSlot,
} from "@k1s0-ts-storage/core";
// テスト対象
import { StorageProvider } from "./StorageProvider.js";
import {
  useStorageScope,
  useStorageValue,
  useTypedSlot,
  type UseStorageStateResult,
} from "./hooks.js";

function buildRegistry(overrides?: Partial<{ durable: KvStore<unknown> }>): StorageRegistry {
  return createStorageRegistry({
    secure: createMemoryStore<unknown>(),
    durable: overrides?.durable ?? createMemoryStore<unknown>(),
    session: createMemoryStore<unknown>(),
    ephemeral: createMemoryStore<unknown>(),
  });
}

// useStorageScope のテスト
describe("useStorageScope", () => {
  it("returns the KvStore for the given scope", () => {
    const registry = buildRegistry();
    let captured: KvStore<unknown> | null = null;
    function Probe(): React.JSX.Element {
      captured = useStorageScope("durable");
      return <></>;
    }
    act(() => {
      create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    expect(captured).toBe(registry.durable);
  });
});

// useStorageValue のテスト
describe("useStorageValue", () => {
  it("loads existing value and updates state", async () => {
    const durable = createMemoryStore<string>();
    await durable.set("k", "preloaded");
    const registry = buildRegistry({ durable: durable as KvStore<unknown> });
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useStorageValue<string>("durable", "k");
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    expect(snapshot?.loading).toBe(false);
    expect(snapshot?.value).toBe("preloaded");
    act(() => {
      renderer!.unmount();
    });
  });
  it("falls back to defaultValue when key is missing", async () => {
    const registry = buildRegistry();
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useStorageValue<string>("durable", "nope", { defaultValue: "fallback" });
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    expect(snapshot?.value).toBe("fallback");
    act(() => {
      renderer!.unmount();
    });
  });
  it("setValue updates store and local state", async () => {
    const durable = createMemoryStore<string>();
    const registry = buildRegistry({ durable: durable as KvStore<unknown> });
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useStorageValue<string>("durable", "k");
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    await act(async () => {
      await snapshot!.setValue("hello");
    });
    expect(snapshot?.value).toBe("hello");
    await expect(durable.get("k")).resolves.toBe("hello");
    act(() => {
      renderer!.unmount();
    });
  });
  it("clear removes value and restores defaultValue", async () => {
    const durable = createMemoryStore<string>();
    await durable.set("k", "v");
    const registry = buildRegistry({ durable: durable as KvStore<unknown> });
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useStorageValue<string>("durable", "k", { defaultValue: "fallback" });
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    await act(async () => {
      await snapshot!.clear();
    });
    expect(snapshot?.value).toBe("fallback");
    await expect(durable.get("k")).resolves.toBeUndefined();
    act(() => {
      renderer!.unmount();
    });
  });
  it("reflects external store changes via subscribe", async () => {
    const durable = createMemoryStore<string>();
    const registry = buildRegistry({ durable: durable as KvStore<unknown> });
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useStorageValue<string>("durable", "k");
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    await act(async () => {
      await durable.set("k", "external");
    });
    expect(snapshot?.value).toBe("external");
    // 別キーの変更は影響しない
    await act(async () => {
      await durable.set("other", "x");
    });
    expect(snapshot?.value).toBe("external");
    await act(async () => {
      await durable.remove("k");
    });
    expect(snapshot?.value).toBeUndefined();
    act(() => {
      renderer!.unmount();
    });
  });
  it("captures errors from store.get", async () => {
    const failing: KvStore<unknown> = {
      get: async () => {
        throw new Error("read failed");
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    const registry = createStorageRegistry({
      secure: createMemoryStore<unknown>(),
      durable: failing,
      session: createMemoryStore<unknown>(),
      ephemeral: createMemoryStore<unknown>(),
    });
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useStorageValue<string>("durable", "k");
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    expect(snapshot?.error).toBeInstanceOf(Error);
    act(() => {
      renderer!.unmount();
    });
  });
  it("works when store does not support subscribe", async () => {
    const noSub: KvStore<unknown> = {
      get: async () => "v",
      set: async () => undefined,
      remove: async () => undefined,
    };
    const registry = createStorageRegistry({
      secure: createMemoryStore<unknown>(),
      durable: noSub,
      session: createMemoryStore<unknown>(),
      ephemeral: createMemoryStore<unknown>(),
    });
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useStorageValue<string>("durable", "k");
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    expect(snapshot?.value).toBe("v");
    act(() => {
      renderer!.unmount();
    });
  });
  it("ignores resolved value after unmount", async () => {
    let resolveValue!: (v: string | undefined) => void;
    const deferred = new Promise<string | undefined>((r) => {
      resolveValue = r;
    });
    const slow: KvStore<unknown> = {
      get: () => deferred as Promise<unknown>,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const registry = createStorageRegistry({
      secure: createMemoryStore<unknown>(),
      durable: slow,
      session: createMemoryStore<unknown>(),
      ephemeral: createMemoryStore<unknown>(),
    });
    function Probe(): React.JSX.Element {
      useStorageValue<string>("durable", "k");
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(() => {
      renderer = create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    act(() => {
      renderer!.unmount();
    });
    await act(async () => {
      resolveValue("late");
    });
  });
  it("ignores rejected error after unmount", async () => {
    let rejectValue!: (e: unknown) => void;
    const deferred = new Promise<unknown>((_, r) => {
      rejectValue = r;
    });
    const slow: KvStore<unknown> = {
      get: () => deferred,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const registry = createStorageRegistry({
      secure: createMemoryStore<unknown>(),
      durable: slow,
      session: createMemoryStore<unknown>(),
      ephemeral: createMemoryStore<unknown>(),
    });
    function Probe(): React.JSX.Element {
      useStorageValue<string>("durable", "k");
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(() => {
      renderer = create(
        <StorageProvider registry={registry}>
          <Probe />
        </StorageProvider>,
      );
    });
    act(() => {
      renderer!.unmount();
    });
    await act(async () => {
      rejectValue(new Error("late error"));
    });
  });
});

// useTypedSlot のテスト
describe("useTypedSlot", () => {
  it("loads slot value", async () => {
    const inner = createMemoryStore<string>();
    await inner.set("tokens", "secret");
    const slot: TypedSlot<string> = createTypedSlot(inner, "tokens");
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useTypedSlot(slot);
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe />);
    });
    expect(snapshot?.value).toBe("secret");
    act(() => {
      renderer!.unmount();
    });
  });
  it("setValue updates slot and state", async () => {
    const inner = createMemoryStore<string>();
    const slot = createTypedSlot(inner, "k");
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useTypedSlot(slot);
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe />);
    });
    await act(async () => {
      await snapshot!.setValue("v");
    });
    expect(snapshot?.value).toBe("v");
    await expect(slot.get()).resolves.toBe("v");
    act(() => {
      renderer!.unmount();
    });
  });
  it("clear resets slot and state to undefined", async () => {
    const inner = createMemoryStore<string>();
    await inner.set("k", "v");
    const slot = createTypedSlot(inner, "k");
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useTypedSlot(slot);
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe />);
    });
    await act(async () => {
      await snapshot!.clear();
    });
    expect(snapshot?.value).toBeUndefined();
    act(() => {
      renderer!.unmount();
    });
  });
  it("reflects external slot changes via subscribe", async () => {
    const inner = createMemoryStore<string>();
    const slot = createTypedSlot(inner, "k");
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useTypedSlot(slot);
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe />);
    });
    await act(async () => {
      await slot.set("external");
    });
    expect(snapshot?.value).toBe("external");
    act(() => {
      renderer!.unmount();
    });
  });
  it("captures errors from slot.get", async () => {
    const failing: TypedSlot<string> = {
      get: async () => {
        throw new Error("read failed");
      },
      set: async () => undefined,
      clear: async () => undefined,
    };
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useTypedSlot(failing);
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe />);
    });
    expect(snapshot?.error).toBeInstanceOf(Error);
    act(() => {
      renderer!.unmount();
    });
  });
  it("works when slot does not support subscribe", async () => {
    const slot: TypedSlot<string> = {
      get: async () => "v",
      set: async () => undefined,
      clear: async () => undefined,
    };
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useTypedSlot(slot);
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe />);
    });
    expect(snapshot?.value).toBe("v");
    act(() => {
      renderer!.unmount();
    });
  });
  it("ignores resolved slot value after unmount", async () => {
    let resolveValue!: (v: string | undefined) => void;
    const deferred = new Promise<string | undefined>((r) => {
      resolveValue = r;
    });
    const slot: TypedSlot<string> = {
      get: () => deferred,
      set: async () => undefined,
      clear: async () => undefined,
    };
    function Probe(): React.JSX.Element {
      useTypedSlot(slot);
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(() => {
      renderer = create(<Probe />);
    });
    act(() => {
      renderer!.unmount();
    });
    await act(async () => {
      resolveValue("late");
    });
  });
  it("ignores rejected slot error after unmount", async () => {
    let rejectValue!: (e: unknown) => void;
    const deferred = new Promise<string | undefined>((_, r) => {
      rejectValue = r;
    });
    const slot: TypedSlot<string> = {
      get: () => deferred,
      set: async () => undefined,
      clear: async () => undefined,
    };
    function Probe(): React.JSX.Element {
      useTypedSlot(slot);
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(() => {
      renderer = create(<Probe />);
    });
    act(() => {
      renderer!.unmount();
    });
    await act(async () => {
      rejectValue(new Error("late error"));
    });
  });
});
