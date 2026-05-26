// vitest API
import { describe, expect, it, vi } from "vitest";
// 対象モジュール
import { composePublishers, createNoopPublisher } from "./publisher.js";
// 型
import type { OutboxEntry, PublishContext } from "./types.js";

// 共通ヘルパ
function makeCtx(): PublishContext {
  // AbortController から signal を取り出す
  const controller = new AbortController();
  return {
    attempt: 0,
    signal: controller.signal,
    idempotencyKey: "ik",
    entryId: "e1",
  };
}
function makeEntry(): OutboxEntry {
  // 最小限のエントリ
  return {
    id: "e1",
    status: "pending",
    payload: {},
    idempotencyKey: "ik",
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: 0,
    updatedAt: 0,
  };
}

// createNoopPublisher
describe("createNoopPublisher", () => {
  // 常に成功する
  it("resolves without doing anything", async () => {
    // 生成
    const publisher = createNoopPublisher();
    // 呼び出して resolved を確認
    await expect(publisher(makeEntry(), makeCtx())).resolves.toBeUndefined();
  });
});

// composePublishers
describe("composePublishers", () => {
  // 空配列はエラー
  it("throws when called with empty publisher list", () => {
    // 空配列で呼ぶと throw
    expect(() => composePublishers([])).toThrow();
  });

  // 1 番目が成功すればそれだけ呼ばれる
  it("returns after the first successful publisher", async () => {
    // 2 つの publisher
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    // 合成
    const composed = composePublishers([a, b]);
    // 実行
    await composed(makeEntry(), makeCtx());
    // a だけ呼ばれた
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  // 1 番目失敗 → 2 番目で成功
  it("falls back to the next publisher when one throws", async () => {
    // a は throw、b は成功
    const a = vi.fn().mockRejectedValue(new Error("a fail"));
    const b = vi.fn().mockResolvedValue(undefined);
    // 合成
    const composed = composePublishers([a, b]);
    // 成功する
    await expect(composed(makeEntry(), makeCtx())).resolves.toBeUndefined();
    // 両方呼ばれている
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  // 全部失敗なら最後のエラーを throw
  it("rethrows the last error when all publishers fail", async () => {
    // 両方 throw
    const a = vi.fn().mockRejectedValue(new Error("a"));
    const b = vi.fn().mockRejectedValue(new Error("b"));
    // 合成
    const composed = composePublishers([a, b]);
    // b のエラーが伝播する
    await expect(composed(makeEntry(), makeCtx())).rejects.toThrow("b");
  });
});
