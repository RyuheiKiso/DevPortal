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

// 全 4 スコープを memory で揃えるヘルパ
function buildRegistry(overrides?: Partial<{ durable: KvStore<unknown> }>): StorageRegistry {
  return createStorageRegistry({
    secure: createMemoryStore<unknown>(),
    durable: overrides?.durable ?? createMemoryStore<unknown>(),
    session: createMemoryStore<unknown>(),
    ephemeral: createMemoryStore<unknown>(),
  });
}

// hooks のテスト
describe("useStorageScope", () => {
  // scope ごとに KvStore を返す
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
  // 初回 loading → 値が読み込まれて value にセットされる
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
    // loading が false、value が読み込まれている
    expect(snapshot?.loading).toBe(false);
    expect(snapshot?.value).toBe("preloaded");
    // 後片付け
    act(() => {
      renderer!.unmount();
    });
  });
  // defaultValue が反映される
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
  // setValue で更新される
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
    // setValue を呼ぶ
    await act(async () => {
      await snapshot!.setValue("hello");
    });
    // local state も store も更新されている
    expect(snapshot?.value).toBe("hello");
    await expect(durable.get("k")).resolves.toBe("hello");
    act(() => {
      renderer!.unmount();
    });
  });
  // clear で defaultValue に戻る
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
    // state は defaultValue
    expect(snapshot?.value).toBe("fallback");
    // store からも消えている
    await expect(durable.get("k")).resolves.toBeUndefined();
    act(() => {
      renderer!.unmount();
    });
  });
  // subscribe 経由の cross-tab 同期 (memory store の subscribe を直接活用)
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
    // 外部から store を変更
    await act(async () => {
      await durable.set("k", "external");
    });
    // state に反映されている
    expect(snapshot?.value).toBe("external");
    // 別キーの変更は影響しない
    await act(async () => {
      await durable.set("other", "x");
    });
    expect(snapshot?.value).toBe("external");
    // 削除も反映される
    await act(async () => {
      await durable.remove("k");
    });
    expect(snapshot?.value).toBeUndefined();
    act(() => {
      renderer!.unmount();
    });
  });
  // get 中のエラーを捕捉
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
    expect(snapshot?.loading).toBe(false);
    act(() => {
      renderer!.unmount();
    });
  });
  // unmount で cancel フラグが立ち、その後の resolve では setState されない
  it("ignores resolved value after unmount", async () => {
    // 未解決の Promise を作っておく
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
    // unmount してから resolve する
    act(() => {
      renderer!.unmount();
    });
    // resolve しても warning にならない (cancelled が立っているので setState されない)
    await act(async () => {
      resolveValue("late");
    });
  });
  // unmount で rejected も無視される
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
  // store が subscribe を持たない場合は購読フックが noop
  it("works when store does not support subscribe", async () => {
    const noSubscribe: KvStore<unknown> = {
      get: async () => "v",
      set: async () => undefined,
      remove: async () => undefined,
    };
    const registry = createStorageRegistry({
      secure: createMemoryStore<unknown>(),
      durable: noSubscribe,
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
});

// useTypedSlot のテスト
describe("useTypedSlot", () => {
  // 初回読込
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
  // setValue で更新
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
  // clear で undefined に戻る
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
  // subscribe 経由で外部変更を反映
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
  // get 中のエラーを捕捉
  it("captures errors from slot.get", async () => {
    const failingSlot: TypedSlot<string> = {
      get: async () => {
        throw new Error("read failed");
      },
      set: async () => undefined,
      clear: async () => undefined,
    };
    let snapshot: UseStorageStateResult<string> | null = null;
    function Probe(): React.JSX.Element {
      snapshot = useTypedSlot(failingSlot);
      return <></>;
    }
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Probe />);
    });
    expect(snapshot?.error).toBeInstanceOf(Error);
    expect(snapshot?.loading).toBe(false);
    act(() => {
      renderer!.unmount();
    });
  });
  // unmount 後の resolve は反映されない
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
  // unmount 後の reject は反映されない
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
  // subscribe を持たない slot
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
});
