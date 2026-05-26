// vitest API
import { describe, expect, it } from "vitest";
// 対象
import { findEntryByDedupeKey } from "./dedupe.js";
// 型
import type { OutboxEntry } from "./types.js";

// テスト用の最小エントリ生成ヘルパ
function makeEntry(id: string, dedupeKey?: string): OutboxEntry {
  // 必須フィールドだけ埋めた最小値
  return {
    id,
    status: "pending",
    payload: { v: id },
    idempotencyKey: id,
    dedupeKey,
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: 0,
    updatedAt: 0,
  };
}

// findEntryByDedupeKey の動作を検証
describe("findEntryByDedupeKey", () => {
  // 該当キーが存在する場合
  it("returns the matching entry and its index", () => {
    // 配列を用意
    const entries = [
      makeEntry("a", "k1"),
      makeEntry("b", "k2"),
      makeEntry("c", "k3"),
    ];
    // k2 を検索
    const result = findEntryByDedupeKey(entries, "k2");
    // 該当する index と entry が返る
    expect(result?.index).toBe(1);
    expect(result?.entry.id).toBe("b");
  });

  // 該当が無い場合
  it("returns null when no entry matches", () => {
    // 何も dedupeKey が一致しない
    const entries = [makeEntry("a", "k1"), makeEntry("b")];
    // 検索
    const result = findEntryByDedupeKey(entries, "missing");
    // null
    expect(result).toBeNull();
  });

  // 空配列
  it("returns null for empty list", () => {
    // 空配列を渡す
    const result = findEntryByDedupeKey([], "k");
    // null
    expect(result).toBeNull();
  });
});
