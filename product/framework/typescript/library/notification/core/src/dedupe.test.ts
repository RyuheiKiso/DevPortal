// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { findByDedupeKey } from "./dedupe.js";
// テスト用の型
import type { AppNotification } from "./types.js";

// テスト用の最小 toast 生成
function toast(id: string, dedupeKey?: string): AppNotification {
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

  // kindFilter 指定時は別 kind を素通しする
  it("kindFilter 指定時、別 kind の通知はスキップして次の同 kind を返す", () => {
    // dialog (kind 不一致, key 一致) と toast (kind 一致, key 一致) が混在
    const queue: AppNotification[] = [
      // dialog: 先頭で見つかるが kindFilter で除外したい
      {
        id: "d1",
        kind: "dialog",
        title: "t",
        message: "m",
        actions: [],
        createdAt: 0,
        dedupeKey: "k1",
      },
      // toast: kindFilter で採用される側
      toast("t1", "k1"),
    ];
    // kindFilter="toast" で探すと toast t1 がヒットする
    const result = findByDedupeKey(queue, "k1", "toast");
    expect(result?.notification.id).toBe("t1");
    expect(result?.index).toBe(1);
  });

  // kindFilter 指定時に該当 kind が無ければ null
  it("kindFilter 指定で該当 kind が無ければ null を返す", () => {
    const queue: AppNotification[] = [
      {
        id: "d1",
        kind: "dialog",
        title: "t",
        message: "m",
        actions: [],
        createdAt: 0,
        dedupeKey: "k1",
      },
    ];
    // kindFilter="toast" で探しても dialog しか無いので null
    expect(findByDedupeKey(queue, "k1", "toast")).toBeNull();
  });
});
