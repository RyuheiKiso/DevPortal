// vitest API
import { describe, expect, it } from "vitest";
// 対象モジュール
import { createOutboxStorage, type KvStoreLike } from "./storage.js";
// 型
import type { OutboxEntry } from "./types.js";
// エラー型
import { OutboxError, isOutboxError } from "./errors.js";

// メモリ KvStore 実装 (テスト用)
function createMemoryKv(): KvStoreLike & { snapshot(): Map<string, unknown> } {
  // 内部マップ
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      // 未保存なら undefined
      return map.get(key);
    },
    async set(key, value) {
      // 上書き
      map.set(key, value);
    },
    async remove(key) {
      // 存在削除
      map.delete(key);
    },
    snapshot() {
      // 検証用に内部を返す
      return map;
    },
  };
}

// 最小エントリ生成
function makeEntry(id: string, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  // 必須を埋める
  return {
    id,
    status: "pending",
    payload: { id },
    idempotencyKey: `ik-${id}`,
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// 基本 CRUD
describe("createOutboxStorage CRUD", () => {
  // save → load の往復
  it("save and load round-trips an entry", async () => {
    // メモリ KV を用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 保存
    const entry = makeEntry("a");
    await storage.save(entry);
    // load 結果
    const loaded = await storage.load("a");
    // 同等値が返る
    expect(loaded).toEqual(entry);
  });

  // 未保存 ID は undefined
  it("load returns undefined for missing id", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 未保存
    expect(await storage.load("missing")).toBeUndefined();
  });

  // namespace カスタマイズ
  it("respects custom namespace", async () => {
    // 別 namespace を指定
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv, { namespace: "myns" });
    // 保存
    const entry = makeEntry("a");
    await storage.save(entry);
    // 内部 key 確認
    expect(kv.snapshot().has("myns:entry:a")).toBe(true);
    expect(kv.snapshot().has("myns:index")).toBe(true);
  });

  // remove は本体・DLQ 両方から削除
  it("remove deletes from both entry and dlq stores", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 保存
    await storage.save(makeEntry("a"));
    // 削除
    await storage.remove("a");
    // 取得すると undefined
    expect(await storage.load("a")).toBeUndefined();
  });

  // 同じ id を 2 回 save しても index は 1 件
  it("save twice does not duplicate id in index", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 2 回保存
    await storage.save(makeEntry("a"));
    await storage.save(makeEntry("a"));
    // list 結果は 1 件
    const all = await storage.list(false);
    expect(all.length).toBe(1);
  });
});

// list の動作
describe("createOutboxStorage list", () => {
  // 複数件の取得
  it("returns all saved entries in insertion order", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 3 件保存
    await storage.save(makeEntry("a"));
    await storage.save(makeEntry("b"));
    await storage.save(makeEntry("c"));
    // list
    const all = await storage.list(false);
    expect(all.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  // index にあるが本体が欠けている場合はスキップ
  it("skips entries whose body is missing", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 保存後、本体だけ削除する (index は残る)
    await storage.save(makeEntry("a"));
    await kv.remove("outbox:entry:a");
    // list は 0 件
    const all = await storage.list(false);
    expect(all.length).toBe(0);
  });

  // index が壊れた値 (非配列) の場合は空配列扱い
  it("treats non-array index as empty", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 不正値を直接書く
    await kv.set("outbox:index", "broken");
    // list は空
    const all = await storage.list(false);
    expect(all.length).toBe(0);
  });

  // index 配列に文字列以外が混ざっていればフィルタ
  it("filters out non-string ids from index", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 保存
    await storage.save(makeEntry("a"));
    // index に数値を混ぜる
    await kv.set("outbox:index", ["a", 42]);
    // list は a のみ
    const all = await storage.list(false);
    expect(all.map((e) => e.id)).toEqual(["a"]);
  });
});

// DLQ 操作
describe("createOutboxStorage DLQ", () => {
  // moveToDlq で DLQ に移る
  it("moveToDlq moves entry from main to dlq", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 保存して DLQ へ
    await storage.save(makeEntry("a"));
    await storage.moveToDlq("a");
    // 本体は無くなり DLQ にある
    expect(kv.snapshot().has("outbox:entry:a")).toBe(false);
    expect(kv.snapshot().has("outbox:dlq:a")).toBe(true);
    // 本体 list は空、DLQ list に出る
    expect((await storage.list(false)).length).toBe(0);
    expect((await storage.list(true)).map((e) => e.id)).toEqual(["a"]);
  });

  // 存在しない id の moveToDlq は no-op
  it("moveToDlq is no-op for missing id", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 存在しない ID
    await storage.moveToDlq("nope");
    // 何も変化しない
    expect(kv.snapshot().size).toBe(0);
  });

  // restoreFromDlq で本体に戻る
  it("restoreFromDlq moves entry back to main", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // dead 経由
    await storage.save(makeEntry("a"));
    await storage.moveToDlq("a");
    // 復元
    await storage.restoreFromDlq("a");
    // 本体側に戻る
    expect(kv.snapshot().has("outbox:entry:a")).toBe(true);
    expect(kv.snapshot().has("outbox:dlq:a")).toBe(false);
  });

  // restoreFromDlq は DLQ になければ no-op
  it("restoreFromDlq is no-op for missing dlq id", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 存在しない ID
    await storage.restoreFromDlq("nope");
    // 何も無し
    expect(kv.snapshot().size).toBe(0);
  });

  // load は DLQ も検索する
  it("load also searches dlq when not in main", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // DLQ へ移動
    await storage.save(makeEntry("a"));
    await storage.moveToDlq("a");
    // load で取得可能
    expect((await storage.load("a"))?.id).toBe("a");
  });
});

// PERSISTENCE_FAILED ラップの動作
describe("createOutboxStorage error wrapping", () => {
  // kv.get が throw すると OutboxError(PERSISTENCE_FAILED) に変換される
  it("wraps kv.get errors as OUTBOX_PERSISTENCE_FAILED", async () => {
    // get だけ throw する KV
    const failingKv: KvStoreLike = {
      async get() { throw new Error("kv get boom"); },
      async set() {},
      async remove() {},
    };
    const storage = createOutboxStorage(failingKv);
    // load で OutboxError
    let caught: unknown;
    try {
      await storage.load("a");
    } catch (e) {
      caught = e;
    }
    expect(isOutboxError(caught)).toBe(true);
    expect((caught as OutboxError).code).toBe("OUTBOX_PERSISTENCE_FAILED");
    // cause に元エラーが入っている
    expect((caught as OutboxError).cause).toBeInstanceOf(Error);
  });

  // kv.set が throw すると save も OutboxError
  it("wraps kv.set errors", async () => {
    const failingKv: KvStoreLike = {
      async get() { return undefined; },
      async set() { throw new Error("kv set boom"); },
      async remove() {},
    };
    const storage = createOutboxStorage(failingKv);
    let caught: unknown;
    try {
      await storage.save(makeEntry("a"));
    } catch (e) {
      caught = e;
    }
    expect((caught as OutboxError).code).toBe("OUTBOX_PERSISTENCE_FAILED");
  });

  // 既に OutboxError なら二重ラップしない
  it("does not re-wrap existing OutboxError", async () => {
    const existing = new OutboxError({ code: "OUTBOX_INVALID_STATE", message: "x" });
    const failingKv: KvStoreLike = {
      async get() { throw existing; },
      async set() {},
      async remove() {},
    };
    const storage = createOutboxStorage(failingKv);
    let caught: unknown;
    try {
      await storage.load("a");
    } catch (e) {
      caught = e;
    }
    // 元の OutboxError がそのまま伝播
    expect(caught).toBe(existing);
  });
});

// withLock の動作
describe("createOutboxStorage withLock", () => {
  // 同じ id への 2 つの op が直列化される
  it("serializes concurrent operations on the same id", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 実行順を記録
    const order: string[] = [];
    // 2 つの op (微小な遅延付き)
    const p1 = storage.withLock("a", async () => {
      order.push("p1-start");
      await new Promise((r) => setTimeout(r, 5));
      order.push("p1-end");
    });
    const p2 = storage.withLock("a", async () => {
      order.push("p2-start");
      order.push("p2-end");
    });
    // どちらも完了するまで待つ
    await Promise.all([p1, p2]);
    // p1 が完全に終わってから p2 が動く
    expect(order).toEqual(["p1-start", "p1-end", "p2-start", "p2-end"]);
  });

  // 異なる id は並行に実行できる
  it("allows concurrent operations on different ids", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 実行順
    const order: string[] = [];
    // 異なる id への op を同時起動
    const p1 = storage.withLock("a", async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 10));
      order.push("a-end");
    });
    const p2 = storage.withLock("b", async () => {
      order.push("b-start");
      order.push("b-end");
    });
    // 両方完了
    await Promise.all([p1, p2]);
    // b は a を待たずに走り終える
    expect(order[0]).toBe("a-start");
    expect(order[1]).toBe("b-start");
  });

  // op が throw しても次の op は走る
  it("continues serial chain after a throwing op", async () => {
    // KV 用意
    const kv = createMemoryKv();
    const storage = createOutboxStorage(kv);
    // 1 つ目は throw
    const order: string[] = [];
    const p1 = storage.withLock("a", async () => {
      order.push("p1");
      throw new Error("p1 fail");
    });
    // 2 つ目は問題なし
    const p2 = storage.withLock("a", async () => {
      order.push("p2");
    });
    // p1 は失敗、p2 は成功
    await expect(p1).rejects.toThrow("p1 fail");
    await p2;
    // 順序維持
    expect(order).toEqual(["p1", "p2"]);
  });
});
