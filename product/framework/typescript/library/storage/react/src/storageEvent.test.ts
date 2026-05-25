// vitest API を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { attachStorageEvents } from "./storageEvent.js";
// core の withObservable を取り込み
import { createMemoryStore, withObservable } from "@k1s0-ts-storage/core";

// storage event を fire するヘルパ (jsdom で StorageEvent constructor が使える)
function fireStorageEvent(init: StorageEventInit): void {
  // StorageEvent を作って window に dispatch
  const event = new StorageEvent("storage", init);
  window.dispatchEvent(event);
}

// attachStorageEvents の網羅テスト
describe("attachStorageEvents", () => {
  // 基本: storage event を observable に橋渡しする
  it("forwards storage events to observable.emit", () => {
    const inner = createMemoryStore<string>();
    const observable = withObservable<string>()(inner);
    const listener = vi.fn();
    observable.subscribe(listener);
    const detach = attachStorageEvents<string>(observable);
    // storage event を発火
    fireStorageEvent({ key: "k", newValue: "v", oldValue: null });
    // observable に伝搬されている
    expect(listener).toHaveBeenCalledWith("k", "v", undefined);
    // 解除
    detach();
  });
  // key === null (clear イベント) はスキップ
  it("ignores storage events with null key", () => {
    const inner = createMemoryStore<string>();
    const observable = withObservable<string>()(inner);
    const listener = vi.fn();
    observable.subscribe(listener);
    const detach = attachStorageEvents<string>(observable);
    fireStorageEvent({ key: null, newValue: null, oldValue: null });
    expect(listener).not.toHaveBeenCalled();
    detach();
  });
  // keyFilter で対象外をスキップ
  it("filters events by keyFilter", () => {
    const inner = createMemoryStore<string>();
    const observable = withObservable<string>()(inner);
    const listener = vi.fn();
    observable.subscribe(listener);
    const detach = attachStorageEvents<string>(observable, {
      keyFilter: (k) => k.startsWith("app:"),
    });
    fireStorageEvent({ key: "other:k", newValue: "v", oldValue: null });
    fireStorageEvent({ key: "app:k", newValue: "v", oldValue: null });
    // app: 配下のみ通知
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("app:k", "v", undefined);
    detach();
  });
  // decode 関数で値を変換
  it("decodes raw string values through provided decode", () => {
    const inner = createMemoryStore<{ v: number }>();
    const observable = withObservable<{ v: number }>()(inner);
    const listener = vi.fn();
    observable.subscribe(listener);
    const detach = attachStorageEvents<{ v: number }>(observable, {
      // JSON で decode
      decode: (raw) => (raw === null ? undefined : (JSON.parse(raw) as { v: number })),
    });
    fireStorageEvent({ key: "k", newValue: JSON.stringify({ v: 42 }), oldValue: JSON.stringify({ v: 1 }) });
    // decode 済みの構造体が通知される
    expect(listener).toHaveBeenCalledWith("k", { v: 42 }, { v: 1 });
    detach();
  });
  // 注入 window
  it("accepts an injected window", () => {
    // window 互換の最小スタブ
    let handler: ((e: StorageEvent) => void) | null = null;
    const fakeWindow = {
      addEventListener(type: string, h: EventListener): void {
        if (type === "storage") handler = h as (e: StorageEvent) => void;
      },
      removeEventListener(type: string, _h: EventListener): void {
        if (type === "storage") handler = null;
      },
    } as unknown as Window;
    const inner = createMemoryStore<string>();
    const observable = withObservable<string>()(inner);
    const listener = vi.fn();
    observable.subscribe(listener);
    const detach = attachStorageEvents<string>(observable, { window: fakeWindow });
    expect(handler).not.toBeNull();
    // 手動で event を発火
    handler?.(new StorageEvent("storage", { key: "k", newValue: "v", oldValue: null }));
    expect(listener).toHaveBeenCalled();
    // detach で handler が null に戻る
    detach();
    expect(handler).toBeNull();
  });
  // detach 後はイベントが届かない
  it("stops forwarding after detach", () => {
    const inner = createMemoryStore<string>();
    const observable = withObservable<string>()(inner);
    const listener = vi.fn();
    observable.subscribe(listener);
    const detach = attachStorageEvents<string>(observable);
    detach();
    fireStorageEvent({ key: "k", newValue: "v", oldValue: null });
    expect(listener).not.toHaveBeenCalled();
  });
});
