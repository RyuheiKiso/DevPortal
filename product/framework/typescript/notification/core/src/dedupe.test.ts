// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { findByDedupeKey } from "./dedupe.js";
// テスト用の型
import type { Notification } from "./types.js";

// テスト用の最小 toast 生成
function toast(id: string, dedupeKey?: string): Notification {
  return {
    id,
    kind: "toast",
    level: "info",
    message: `msg-${id}`,
    createdAt: 0,
    dedupeKey,
  };
}

describe("findByDedupeKey", () => {
  // 一致する dedupeKey を持つ通知を見つける
  it("一致する dedupeKey を見つけたら index と通知を返す", () => {
    const queue = [toast("a"), toast("b", "k1"), toast("c", "k2")];
    const result = findByDedupeKey(queue, "k1");
    // index は 1
    expect(result).not.toBeNull();
    expect(result?.index).toBe(1);
    expect(result?.notification.id).toBe("b");
  });

  // 該当が無いときは null
  it("一致が無いときは null を返す", () => {
    const queue = [toast("a"), toast("b", "k1")];
    expect(findByDedupeKey(queue, "missing")).toBeNull();
  });

  // 空配列は null
  it("空配列の場合は null を返す", () => {
    expect(findByDedupeKey([], "k1")).toBeNull();
  });
});
