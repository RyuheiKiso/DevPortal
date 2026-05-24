// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { createStorageTransport } from "./storage.js";
// 型を取り込み
import type { LogEntry, StorageAdapter } from "../types.js";

// 同期 KV ストアのインメモリ実装
function makeSyncStorage(initial?: Record<string, string>): StorageAdapter & { dump: () => Record<string, string> } {
  // 内部マップ
  const store: Record<string, string> = { ...(initial ?? {}) };
  return {
    // getItem は同期 string|null
    getItem: (k) => (k in store ? store[k] ?? null : null),
    // setItem は同期 void
    setItem: (k, v) => {
      store[k] = v;
    },
    // removeItem は同期 void
    removeItem: (k) => {
      delete store[k];
    },
    // テスト確認用に内容を覗く
    dump: () => ({ ...store }),
  };
}

// 非同期 KV ストアのインメモリ実装
function makeAsyncStorage(): StorageAdapter & { dump: () => Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    // 非同期で値を返す
    getItem: (k) => Promise.resolve(k in store ? store[k] ?? null : null),
    // 非同期で保存
    setItem: (k, v) =>
      new Promise((resolve) => {
        store[k] = v;
        resolve();
      }),
    // 非同期で削除
    removeItem: (k) =>
      new Promise((resolve) => {
        delete store[k];
        resolve();
      }),
    // 確認用
    dump: () => ({ ...store }),
  };
}

// 簡易エントリ生成
function entry(message: string): LogEntry {
  return { level: "info", message, timestamp: 0 };
}

describe("createStorageTransport", () => {
  // name の既定値
  it("name は 'storage'", () => {
    const t = createStorageTransport({ storage: makeSyncStorage() });
    expect(t.name).toBe("storage");
  });

  // 同期ストアで書き込みと読み出しが整合する
  it("同期ストアで write 後に JSON 配列として保存される", async () => {
    const s = makeSyncStorage();
    const t = createStorageTransport({ storage: s });
    await t.write(entry("a"));
    // 既定キーで保存される
    const raw = s.dump()["k1s0-ts-logger:entries"];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].message).toBe("a");
  });

  // 非同期ストアでも write が await 可能
  it("非同期ストアでも write が await 可能", async () => {
    const s = makeAsyncStorage();
    const t = createStorageTransport({ storage: s });
    await t.write(entry("async"));
    const raw = s.dump()["k1s0-ts-logger:entries"];
    expect(JSON.parse(raw!)[0].message).toBe("async");
  });

  // 既存値に追記される
  it("既存配列に新エントリが追記される", async () => {
    const s = makeSyncStorage({ "k1s0-ts-logger:entries": JSON.stringify([entry("first")]) });
    const t = createStorageTransport({ storage: s });
    await t.write(entry("second"));
    const parsed = JSON.parse(s.dump()["k1s0-ts-logger:entries"]!);
    expect(parsed.map((e: LogEntry) => e.message)).toEqual(["first", "second"]);
  });

  // maxEntries 超過で古い方が捨てられる
  it("maxEntries 超過時は最古エントリが破棄される", async () => {
    // 初期に 3 件ある状態
    const initial = JSON.stringify([entry("a"), entry("b"), entry("c")]);
    const s = makeSyncStorage({ "k1s0-ts-logger:entries": initial });
    // 上限 2 で書き込み（合計 4 件のうち末尾 2 件のみ残る）
    const t = createStorageTransport({ storage: s, maxEntries: 2 });
    await t.write(entry("d"));
    const parsed = JSON.parse(s.dump()["k1s0-ts-logger:entries"]!);
    expect(parsed.map((e: LogEntry) => e.message)).toEqual(["c", "d"]);
  });

  // 壊れた JSON でも空配列にフォールバック
  it("既存値が JSON でない場合は空配列から始める", async () => {
    const s = makeSyncStorage({ "k1s0-ts-logger:entries": "{not-json" });
    const t = createStorageTransport({ storage: s });
    await t.write(entry("recovered"));
    const parsed = JSON.parse(s.dump()["k1s0-ts-logger:entries"]!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].message).toBe("recovered");
  });

  // JSON だが配列でない値も空配列扱い
  it("既存値が JSON 配列でない場合も空配列から始める", async () => {
    const s = makeSyncStorage({ "k1s0-ts-logger:entries": "{}" });
    const t = createStorageTransport({ storage: s });
    await t.write(entry("recovered"));
    const parsed = JSON.parse(s.dump()["k1s0-ts-logger:entries"]!);
    expect(parsed).toHaveLength(1);
  });

  // 任意の key を指定できる
  it("key 指定で保存先キーを変更できる", async () => {
    const s = makeSyncStorage();
    const t = createStorageTransport({ storage: s, key: "custom:key" });
    await t.write(entry("x"));
    expect(s.dump()["custom:key"]).toBeDefined();
  });

  // replacer 既定値が Error を展開する
  it("Error が既定 replacer で展開される", async () => {
    const s = makeSyncStorage();
    const t = createStorageTransport({ storage: s });
    // Error オブジェクトを meta に含めるエントリ
    const e: LogEntry = {
      level: "error",
      message: "fail",
      timestamp: 0,
      meta: { err: new Error("boom") },
    };
    await t.write(e);
    const raw = s.dump()["k1s0-ts-logger:entries"]!;
    // JSON 化された結果に message: "boom" が含まれる
    expect(raw).toContain("boom");
    // Error クラス名も含まれる
    expect(raw).toContain("Error");
  });

  // replacer を任意に差し替えできる
  it("replacer を差し替えると JSON.stringify に反映される", async () => {
    const s = makeSyncStorage();
    // 値を全部 "REDACTED" に置換する replacer
    const replacer = vi.fn((_k: string, v: unknown) => (typeof v === "string" ? "REDACTED" : v));
    const t = createStorageTransport({ storage: s, replacer });
    await t.write(entry("secret"));
    const raw = s.dump()["k1s0-ts-logger:entries"]!;
    // 元の "secret" は出現しない
    expect(raw).not.toContain("secret");
    // REDACTED が出現する
    expect(raw).toContain("REDACTED");
    // replacer が呼ばれた
    expect(replacer).toHaveBeenCalled();
  });

  // 並行 write でも entries が直列化されてロスしない
  it("並行 write が直列化され、entries が両方保存される", async () => {
    const s = makeAsyncStorage();
    const t = createStorageTransport({ storage: s });
    // 2 件を同時に write 起動（直列化されないと最後の write が前の write を上書きする）
    const p1 = t.write(entry("a"));
    const p2 = t.write(entry("b"));
    // 両方の write を待つ
    await Promise.all([p1, p2]);
    const parsed = JSON.parse(s.dump()["k1s0-ts-logger:entries"]!);
    // 順序通り 2 件保存されている
    expect(parsed.map((e: LogEntry) => e.message)).toEqual(["a", "b"]);
  });

  // flush で末尾まで完了を待てる
  it("flush は末尾までの write 完了を保証する", async () => {
    const s = makeAsyncStorage();
    const t = createStorageTransport({ storage: s });
    // 起動だけして await しない
    void t.write(entry("a"));
    // flush で完了を保証
    await t.flush?.();
    const parsed = JSON.parse(s.dump()["k1s0-ts-logger:entries"]!);
    expect(parsed.map((e: LogEntry) => e.message)).toEqual(["a"]);
  });

  // dispose も末尾まで完了を待つ
  it("dispose は末尾までの write 完了を保証する", async () => {
    const s = makeAsyncStorage();
    const t = createStorageTransport({ storage: s });
    void t.write(entry("a"));
    await t.dispose?.();
    const parsed = JSON.parse(s.dump()["k1s0-ts-logger:entries"]!);
    expect(parsed.map((e: LogEntry) => e.message)).toEqual(["a"]);
  });

  // write が失敗しても後続の write は走る
  it("write が失敗しても後続の write は実行される", async () => {
    // 1 回目の setItem で失敗、それ以降は成功する adapter
    let calls = 0;
    const store: Record<string, string> = {};
    const adapter: StorageAdapter = {
      getItem: (k) => Promise.resolve(store[k] ?? null),
      setItem: (k, v) =>
        new Promise<void>((resolve, reject) => {
          calls += 1;
          if (calls === 1) {
            reject(new Error("transient"));
            return;
          }
          store[k] = v;
          resolve();
        }),
      removeItem: () => Promise.resolve(),
    };
    const t = createStorageTransport({ storage: adapter });
    // 1 回目は失敗
    await expect(t.write(entry("a"))).rejects.toThrow("transient");
    // 2 回目は成功し、存在として保存される
    await t.write(entry("b"));
    const parsed = JSON.parse(store["k1s0-ts-logger:entries"]!);
    expect(parsed.map((e: LogEntry) => e.message)).toEqual(["b"]);
  });
});
