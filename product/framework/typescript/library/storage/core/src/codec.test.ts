// vitest API を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { base64Codec, jsonCodec, stringCodec, withCodec } from "./codec.js";
// メモリストア
import { createMemoryStore } from "./memory.js";
// 公開型
import type { KvStore } from "./types.js";

// jsonCodec のテスト
describe("jsonCodec", () => {
  // 基本 round-trip
  it("round-trips a plain object", () => {
    // codec を生成
    const codec = jsonCodec<{ a: number; b: string }>();
    // encode → decode で復元できる
    const encoded = codec.encode({ a: 1, b: "x" });
    expect(codec.decode(encoded)).toEqual({ a: 1, b: "x" });
  });
  // Error の既定 replacer (展開)
  it("expands Error instances via the default replacer", () => {
    // codec を生成
    const codec = jsonCodec<{ err: Error }>();
    // Error を内包する値を encode
    const encoded = codec.encode({ err: new Error("boom") });
    // 戻し
    const decoded = codec.decode(encoded) as { err: { name: string; message: string } };
    // name と message が展開されている
    expect(decoded.err.name).toBe("Error");
    expect(decoded.err.message).toBe("boom");
  });
  // カスタム replacer
  it("uses custom replacer when provided", () => {
    // null を __null__ 文字列に変換するカスタム replacer
    const replacer = vi.fn((_k: string, v: unknown) => (v === null ? "__null__" : v));
    // codec を生成
    const codec = jsonCodec<{ x: unknown }>({ replacer });
    // encode で replacer が呼ばれる
    const encoded = codec.encode({ x: null });
    // replacer が呼ばれている
    expect(replacer).toHaveBeenCalled();
    // 変換結果が反映されている
    expect(JSON.parse(encoded)).toEqual({ x: "__null__" });
  });
  // カスタム reviver
  it("uses custom reviver when provided", () => {
    // "__null__" を null に戻す reviver
    const reviver = (_k: string, v: unknown) => (v === "__null__" ? null : v);
    // codec を生成
    const codec = jsonCodec<{ x: unknown }>({ reviver });
    // 既知の文字列を decode
    const decoded = codec.decode(JSON.stringify({ x: "__null__" }));
    // 復元されている
    expect(decoded).toEqual({ x: null });
  });
  // space オプションが encode に反映される
  it("honors the space option on encode", () => {
    // 整形指定で codec を生成
    const codec = jsonCodec<{ a: number }>({ space: 2 });
    // 改行とインデントが入る
    const encoded = codec.encode({ a: 1 });
    expect(encoded).toContain("\n");
  });
});

// stringCodec のテスト
describe("stringCodec", () => {
  // 恒等
  it("encode and decode are identity functions", () => {
    // codec を生成
    const codec = stringCodec();
    // encode は恒等
    expect(codec.encode("abc")).toBe("abc");
    // decode も恒等
    expect(codec.decode("abc")).toBe("abc");
  });
});

// base64Codec のテスト
describe("base64Codec", () => {
  // round-trip
  it("round-trips byte arrays", () => {
    // codec を生成
    const codec = base64Codec();
    // 入力 byte 列
    const input = new Uint8Array([0, 1, 2, 255]);
    // encode → decode で復元
    const round = codec.decode(codec.encode(input));
    // 長さと各バイトが一致
    expect(round.length).toBe(input.length);
    for (let i = 0; i < input.length; i++) {
      expect(round[i]).toBe(input[i]);
    }
  });
  // 空配列
  it("handles empty buffer", () => {
    // codec
    const codec = base64Codec();
    // 空 → 空
    expect(codec.encode(new Uint8Array(0))).toBe("");
    expect(codec.decode("").length).toBe(0);
  });
});

// withCodec のテスト
describe("withCodec", () => {
  // round-trip via underlying string store
  it("encodes on set and decodes on get", async () => {
    // 内部 string store
    const inner = createMemoryStore<string>();
    // codec ラップ
    const wrapped = withCodec<string, { v: number }>(jsonCodec<{ v: number }>())(inner);
    // set
    await wrapped.set("k", { v: 42 });
    // 内部は文字列として保存される
    await expect(inner.get("k")).resolves.toBe(JSON.stringify({ v: 42 }));
    // 外側は decode 済み
    await expect(wrapped.get("k")).resolves.toEqual({ v: 42 });
  });
  // 未保存 get は undefined
  it("returns undefined for missing keys", async () => {
    // 内部 string store
    const inner = createMemoryStore<string>();
    // codec ラップ
    const wrapped = withCodec<string, { v: number }>(jsonCodec<{ v: number }>())(inner);
    // 未保存
    await expect(wrapped.get("nope")).resolves.toBeUndefined();
  });
  // remove を素通しする
  it("remove delegates to inner", async () => {
    // 内部 store
    const inner = createMemoryStore<string>();
    // wrap
    const wrapped = withCodec<string, { v: number }>(jsonCodec<{ v: number }>())(inner);
    // set して remove
    await wrapped.set("k", { v: 1 });
    await wrapped.remove("k");
    // 内部からも消えている
    await expect(inner.get("k")).resolves.toBeUndefined();
  });
  // has / keys / clear が素通しされる
  it("propagates has, keys, and clear when inner provides them", async () => {
    // 内部 store
    const inner = createMemoryStore<string>();
    // wrap
    const wrapped = withCodec<string, { v: number }>(jsonCodec<{ v: number }>())(inner);
    // has
    await wrapped.set("k", { v: 1 });
    await expect(wrapped.has?.("k")).resolves.toBe(true);
    // keys
    await expect(wrapped.keys?.()).resolves.toEqual(["k"]);
    // clear
    await wrapped.clear?.();
    await expect(wrapped.keys?.()).resolves.toEqual([]);
  });
  // subscribe で decode 済みの値が通知される
  it("subscribe decodes notified values", async () => {
    // 内部 store
    const inner = createMemoryStore<string>();
    // wrap
    const wrapped = withCodec<string, { v: number }>(jsonCodec<{ v: number }>())(inner);
    // listener
    const listener = vi.fn();
    wrapped.subscribe?.(listener);
    // 新規 set
    await wrapped.set("k", { v: 1 });
    // 通知の next は decode 済み、prev は undefined
    expect(listener).toHaveBeenLastCalledWith("k", { v: 1 }, undefined);
    // 上書き
    await wrapped.set("k", { v: 2 });
    // 上書き時は prev も decode 済み
    expect(listener).toHaveBeenLastCalledWith("k", { v: 2 }, { v: 1 });
    // 削除
    await wrapped.remove("k");
    // 削除時は next=undefined, prev は decode 済み
    expect(listener).toHaveBeenLastCalledWith("k", undefined, { v: 2 });
  });
  // 任意機能が無い inner では wrapped にも提供されない
  it("does not expose optional methods when inner lacks them", () => {
    // 最小 KvStore (任意機能なし)
    const inner: KvStore<string> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    // wrap
    const wrapped = withCodec<string, { v: number }>(jsonCodec<{ v: number }>())(inner);
    // 任意機能はすべて undefined
    expect(wrapped.has).toBeUndefined();
    expect(wrapped.keys).toBeUndefined();
    expect(wrapped.clear).toBeUndefined();
    expect(wrapped.subscribe).toBeUndefined();
  });
});
