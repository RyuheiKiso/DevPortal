// vitest API
import { describe, expect, it } from "vitest";
// 対象モジュール
import { buildDlqEntry, buildRestoredEntry, selectAutoArchiveIds } from "./dlq.js";
// 型
import type { OutboxEntry } from "./types.js";

// 最小エントリ作成ヘルパ
function makeEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  // 必須を既定値で埋める
  return {
    id: "e1",
    status: "failed",
    payload: { x: 1 },
    idempotencyKey: "ik",
    attemptCount: 2,
    maxAttempts: 3,
    createdAt: 100,
    updatedAt: 200,
    nextAttemptAt: 300,
    lastError: { message: "boom", at: 250 },
    ...overrides,
  };
}

// buildDlqEntry の動作
describe("buildDlqEntry", () => {
  // 与えた lastError が反映され、status は dead に
  it("sets status=dead and adopts lastError when provided", () => {
    // 元エントリ
    const entry = makeEntry();
    // 新エラー
    const err = { message: "kaboom", at: 999 };
    // dead 化
    const result = buildDlqEntry(entry, err, 1000);
    // status と lastError と updatedAt と nextAttemptAt=undefined
    expect(result.status).toBe("dead");
    expect(result.lastError).toBe(err);
    expect(result.updatedAt).toBe(1000);
    expect(result.nextAttemptAt).toBeUndefined();
  });

  // lastError 未指定なら既存値が維持される
  it("keeps existing lastError when no new error is given", () => {
    // 元エントリ (既に lastError あり)
    const entry = makeEntry();
    // 新エラーなし
    const result = buildDlqEntry(entry, undefined, 2000);
    // 既存 lastError がそのまま
    expect(result.lastError).toEqual({ message: "boom", at: 250 });
    expect(result.updatedAt).toBe(2000);
  });
});

// buildRestoredEntry の動作
describe("buildRestoredEntry", () => {
  // 復元時は pending に戻り attemptCount=0, lastError=undefined
  it("resets attemptCount and clears lastError", () => {
    // dead エントリを用意
    const entry = makeEntry({ status: "dead", attemptCount: 5 });
    // 復元
    const result = buildRestoredEntry(entry, 5000);
    // 状態と値の確認
    expect(result.status).toBe("pending");
    expect(result.attemptCount).toBe(0);
    expect(result.lastError).toBeUndefined();
    expect(result.nextAttemptAt).toBe(5000);
    expect(result.updatedAt).toBe(5000);
    expect(result.sentAt).toBeUndefined();
  });
});

// selectAutoArchiveIds の動作
describe("selectAutoArchiveIds", () => {
  // 上限以下なら空配列
  it("returns empty when under or at max", () => {
    // ちょうど上限
    expect(selectAutoArchiveIds(["a", "b"], 2)).toEqual([]);
    // 上限未満
    expect(selectAutoArchiveIds(["a"], 2)).toEqual([]);
  });

  // 超過分の先頭から FIFO で返す
  it("returns oldest ids to drop", () => {
    // 4 件あって上限 2 → 先頭 2 件 (a,b) を削除候補
    const ids = ["a", "b", "c", "d"];
    expect(selectAutoArchiveIds(ids, 2)).toEqual(["a", "b"]);
  });
});
