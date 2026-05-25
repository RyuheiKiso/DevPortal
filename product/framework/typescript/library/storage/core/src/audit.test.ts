// vitest API を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { withAudit } from "./audit.js";
// メモリストア
import { createMemoryStore } from "./memory.js";
// 公開型
import type { AuditEvent, KvStore } from "./types.js";

// withAudit の網羅テスト
describe("withAudit", () => {
  // get 成功で event 発火
  it("emits successful get event", async () => {
    const inner = createMemoryStore<string>();
    await inner.set("k", "v");
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e) })(inner);
    await expect(wrapped.get("k")).resolves.toBe("v");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ op: "get", key: "k", ok: true });
  });
  // get 失敗で event 発火 + 再 throw
  it("emits failed get event and rethrows", async () => {
    const inner: KvStore<string> = {
      get: async () => {
        throw new Error("read failed");
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e) })(inner);
    let thrown: unknown;
    try {
      await wrapped.get("k");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(events[0]).toMatchObject({ op: "get", ok: false });
    expect(events[0]?.error).toBeInstanceOf(Error);
  });
  // set 成功 + redact あり
  it("emits set event with redacted payload", async () => {
    const inner = createMemoryStore<{ token: string }>();
    const events: AuditEvent[] = [];
    const wrapped = withAudit<{ token: string }>({
      sink: (e) => events.push(e),
      redact: (key, value) => ({ key, masked: value.token.slice(0, 1) + "***" }),
    })(inner);
    await wrapped.set("auth", { token: "secret123" });
    expect(events[0]).toMatchObject({ op: "set", key: "auth", ok: true });
    expect(events[0]?.payload).toEqual({ key: "auth", masked: "s***" });
  });
  // set 成功 + redact なし → payload なし
  it("emits set event without payload when redact is omitted", async () => {
    const inner = createMemoryStore<string>();
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e) })(inner);
    await wrapped.set("k", "v");
    expect(events[0]?.payload).toBeUndefined();
  });
  // set 失敗 → event + 再 throw (redact 適用 payload 込み)
  it("emits failed set event with payload and rethrows", async () => {
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => {
        throw new Error("write failed");
      },
      remove: async () => undefined,
    };
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({
      sink: (e) => events.push(e),
      redact: (_k, v) => `len:${v.length}`,
    })(inner);
    let thrown: unknown;
    try {
      await wrapped.set("k", "hello");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(events[0]).toMatchObject({ op: "set", ok: false });
    expect(events[0]?.payload).toBe("len:5");
  });
  // remove 成功
  it("emits successful remove event", async () => {
    const inner = createMemoryStore<string>();
    await inner.set("k", "v");
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e) })(inner);
    await wrapped.remove("k");
    expect(events[0]).toMatchObject({ op: "remove", key: "k", ok: true });
  });
  // remove 失敗
  it("emits failed remove event and rethrows", async () => {
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => {
        throw new Error("delete failed");
      },
    };
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e) })(inner);
    let thrown: unknown;
    try {
      await wrapped.remove("k");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(events[0]).toMatchObject({ op: "remove", ok: false });
  });
  // clear 成功
  it("emits successful clear event with null key", async () => {
    const inner = createMemoryStore<string>();
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e) })(inner);
    await wrapped.clear?.();
    expect(events[0]).toMatchObject({ op: "clear", key: null, ok: true });
  });
  // clear 失敗
  it("emits failed clear event and rethrows", async () => {
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
      clear: async () => {
        throw new Error("clear failed");
      },
    };
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e) })(inner);
    let thrown: unknown;
    try {
      await wrapped.clear?.();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(events[0]).toMatchObject({ op: "clear", ok: false });
  });
  // scope を AuditEvent に注入
  it("attaches scope when configured", async () => {
    const inner = createMemoryStore<string>();
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e), scope: "secure" })(inner);
    await wrapped.get("k");
    expect(events[0]?.scope).toBe("secure");
  });
  // 任意機能 (has / keys / subscribe) は素通し
  it("propagates has / keys / subscribe without auditing them", async () => {
    const inner = createMemoryStore<string>();
    await inner.set("k", "v");
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e) })(inner);
    // 素通しの動作確認
    await expect(wrapped.has?.("k")).resolves.toBe(true);
    await expect(wrapped.keys?.()).resolves.toEqual(["k"]);
    // subscribe は提供される
    expect(wrapped.subscribe).toBeDefined();
    // has / keys / subscribe では event は発火しない (件数は変わらない)
    expect(events).toHaveLength(0);
    // subscribe を実行して unsubscribe する
    const listener = vi.fn();
    const unsub = wrapped.subscribe?.(listener);
    // 内部 set は wrapped を経由しないので subscribe トリガーには effective には繋がらないが、関数本体は通る
    unsub?.();
  });
  // 任意機能が無い inner では wrapped にも提供されない
  it("does not expose optional methods when inner lacks them", () => {
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const wrapped = withAudit<string>({ sink: () => undefined })(inner);
    expect(wrapped.has).toBeUndefined();
    expect(wrapped.keys).toBeUndefined();
    expect(wrapped.clear).toBeUndefined();
    expect(wrapped.subscribe).toBeUndefined();
  });
  // now を注入できる
  it("uses provided now for timestamps", async () => {
    const inner = createMemoryStore<string>();
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e), now: () => 42 })(inner);
    await wrapped.get("k");
    expect(events[0]?.timestamp).toBe(42);
  });
  // 既定 now (Date.now)
  it("uses Date.now when no now is provided", async () => {
    const inner = createMemoryStore<string>();
    const events: AuditEvent[] = [];
    const wrapped = withAudit<string>({ sink: (e) => events.push(e) })(inner);
    await wrapped.get("k");
    expect(events[0]?.timestamp).toBeGreaterThan(0);
  });
});
