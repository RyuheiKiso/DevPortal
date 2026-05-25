// vitest API を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { withMigration } from "./migration.js";
// メモリストア
import { createMemoryStore } from "./memory.js";
// 公開型
import type { KvStore, Migration } from "./types.js";
// エラーガード
import { isMigrationError } from "./errors.js";

// withMigration の網羅テスト
describe("withMigration", () => {
  // 連続性違反 (fromVersion 不一致) は構築時に throw
  it("throws when migrations are not contiguous (fromVersion mismatch)", () => {
    // 0→1 の後にいきなり 2→3 を置く (1→2 が抜けている)
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v) => v },
      { fromVersion: 2, toVersion: 3, migrate: (v) => v },
    ];
    // wrap 時に MigrationError が投げられる
    let thrown: unknown;
    try {
      withMigration({ migrations });
    } catch (e) {
      thrown = e;
    }
    expect(isMigrationError(thrown)).toBe(true);
  });
  // 連続性違反 (toVersion != fromVersion+1) は構築時に throw
  it("throws when a step skips versions (toVersion not fromVersion+1)", () => {
    // 0→2 のジャンプ
    const migrations: Migration[] = [{ fromVersion: 0, toVersion: 2, migrate: (v) => v }];
    let thrown: unknown;
    try {
      withMigration({ migrations });
    } catch (e) {
      thrown = e;
    }
    expect(isMigrationError(thrown)).toBe(true);
  });
  // 未保存 get は undefined
  it("returns undefined for missing keys", async () => {
    const inner = createMemoryStore<unknown>();
    const wrapped = withMigration<{ v: number }>({ migrations: [] })(inner);
    await expect(wrapped.get("nope")).resolves.toBeUndefined();
  });
  // 最新 version (= latestVersion と一致) はそのまま返却
  it("returns value as-is when version is already latest", async () => {
    // 2 ステップの migrations
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => ({ ...v, lang: "ja" }) },
      { fromVersion: 1, toVersion: 2, migrate: (v: any) => ({ ...v, theme: "light" }) },
    ];
    const inner = createMemoryStore<unknown>();
    // 既に最新 (v2) の値をセット
    await inner.set("preferences", { lang: "ja", theme: "light" });
    await inner.set("__version", 2);
    const wrapped = withMigration<{ lang: string; theme: string }>({ migrations })(inner);
    // get で migration は走らない (=値が変わらない)
    await expect(wrapped.get("preferences")).resolves.toEqual({ lang: "ja", theme: "light" });
  });
  // 2 ステップ適用 + 書き戻し
  it("applies migrations sequentially and writes back", async () => {
    // 0→1 と 1→2 の 2 ステップ
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => ({ ...v, lang: "ja" }) },
      { fromVersion: 1, toVersion: 2, migrate: (v: any) => ({ ...v, theme: "light" }) },
    ];
    const inner = createMemoryStore<unknown>();
    // v0 の値を直接書く (version キーは未設定 → 0 扱い)
    await inner.set("preferences", { user: "alice" });
    const wrapped = withMigration<{ user: string; lang: string; theme: string }>({ migrations })(inner);
    // get で 2 ステップ適用
    await expect(wrapped.get("preferences")).resolves.toEqual({
      user: "alice",
      lang: "ja",
      theme: "light",
    });
    // 書き戻されている (次回 get で migration は走らない)
    await expect(inner.get("preferences")).resolves.toEqual({
      user: "alice",
      lang: "ja",
      theme: "light",
    });
    await expect(inner.get("__version")).resolves.toBe(2);
  });
  // 非同期 migrate
  it("supports async migrate functions", async () => {
    const migrations: Migration[] = [
      {
        fromVersion: 0,
        toVersion: 1,
        migrate: async (v: any) => ({ ...v, async: true }),
      },
    ];
    const inner = createMemoryStore<unknown>();
    await inner.set("k", { v: 1 });
    const wrapped = withMigration<{ v: number; async: boolean }>({ migrations })(inner);
    await expect(wrapped.get("k")).resolves.toEqual({ v: 1, async: true });
  });
  // migrate 中の throw + onError="throw"
  it("rethrows as MigrationError when onError is throw", async () => {
    const migrations: Migration[] = [
      {
        fromVersion: 0,
        toVersion: 1,
        migrate: () => {
          throw new Error("boom");
        },
      },
    ];
    const inner = createMemoryStore<unknown>();
    await inner.set("k", { v: 1 });
    const wrapped = withMigration<unknown>({ migrations, onError: "throw" })(inner);
    let thrown: unknown;
    try {
      await wrapped.get("k");
    } catch (e) {
      thrown = e;
    }
    expect(isMigrationError(thrown)).toBe(true);
  });
  // onError="reset" + fallback あり
  it("resets and writes fallback when onError is reset", async () => {
    const migrations: Migration[] = [
      {
        fromVersion: 0,
        toVersion: 1,
        migrate: () => {
          throw new Error("boom");
        },
      },
    ];
    const inner = createMemoryStore<unknown>();
    await inner.set("k", { v: "old" });
    const wrapped = withMigration<{ v: string }>({
      migrations,
      onError: "reset",
      fallback: { v: "default" },
    })(inner);
    // get は fallback を返す
    await expect(wrapped.get("k")).resolves.toEqual({ v: "default" });
    // inner も fallback で書き換わっている
    await expect(inner.get("k")).resolves.toEqual({ v: "default" });
    // version も最新
    await expect(inner.get("__version")).resolves.toBe(1);
  });
  // onError="reset" + fallback なし
  it("resets without writing when onError is reset and fallback is undefined", async () => {
    const migrations: Migration[] = [
      {
        fromVersion: 0,
        toVersion: 1,
        migrate: () => {
          throw new Error("boom");
        },
      },
    ];
    const inner = createMemoryStore<unknown>();
    await inner.set("k", { v: "old" });
    const wrapped = withMigration<{ v: string }>({ migrations, onError: "reset" })(inner);
    // get は undefined
    await expect(wrapped.get("k")).resolves.toBeUndefined();
    // inner も削除されている
    await expect(inner.get("k")).resolves.toBeUndefined();
  });
  // onError="fallback"
  it("returns fallback without touching store when onError is fallback", async () => {
    const migrations: Migration[] = [
      {
        fromVersion: 0,
        toVersion: 1,
        migrate: () => {
          throw new Error("boom");
        },
      },
    ];
    const inner = createMemoryStore<unknown>();
    await inner.set("k", { v: "old" });
    const wrapped = withMigration<{ v: string }>({
      migrations,
      onError: "fallback",
      fallback: { v: "default" },
    })(inner);
    // get は fallback を返す
    await expect(wrapped.get("k")).resolves.toEqual({ v: "default" });
    // inner はそのまま (古い値が残る)
    await expect(inner.get("k")).resolves.toEqual({ v: "old" });
  });
  // set は値と version を保存する
  it("set also updates the version key", async () => {
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => v },
    ];
    const inner = createMemoryStore<unknown>();
    const wrapped = withMigration<{ x: number }>({ migrations })(inner);
    await wrapped.set("k", { x: 1 });
    // version も書かれている
    await expect(inner.get("__version")).resolves.toBe(1);
  });
  // remove は値だけ消す
  it("remove delegates to inner", async () => {
    const inner = createMemoryStore<unknown>();
    await inner.set("k", { v: 1 });
    await inner.set("__version", 0);
    const wrapped = withMigration<unknown>({ migrations: [] })(inner);
    await wrapped.remove("k");
    await expect(inner.get("k")).resolves.toBeUndefined();
    // version は残る (他キーで使う可能性があるため)
    await expect(inner.get("__version")).resolves.toBe(0);
  });
  // has 素通し
  it("propagates has when inner provides it", async () => {
    const inner = createMemoryStore<unknown>();
    await inner.set("k", { v: 1 });
    const wrapped = withMigration<unknown>({ migrations: [] })(inner);
    await expect(wrapped.has?.("k")).resolves.toBe(true);
  });
  // keys は versionKey を除外
  it("keys filters out the version key", async () => {
    const inner = createMemoryStore<unknown>();
    await inner.set("a", 1);
    await inner.set("b", 2);
    await inner.set("__version", 0);
    const wrapped = withMigration<unknown>({ migrations: [] })(inner);
    const keys = (await wrapped.keys?.()) ?? [];
    expect([...keys].sort()).toEqual(["a", "b"]);
  });
  // clear 素通し
  it("clear delegates to inner", async () => {
    const inner = createMemoryStore<unknown>();
    await inner.set("a", 1);
    await inner.set("__version", 0);
    const wrapped = withMigration<unknown>({ migrations: [] })(inner);
    await wrapped.clear?.();
    await expect(inner.keys?.()).resolves.toEqual([]);
  });
  // 不正 version 値 (数値以外 / Infinity) は 0 扱い → 全 migrate 適用
  it("normalizes invalid version values to 0", async () => {
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => ({ ...v, fixed: true }) },
    ];
    const inner = createMemoryStore<unknown>();
    await inner.set("k", { x: 1 });
    // 不正な version 値を入れておく (string)
    await inner.set("__version", "not-a-number" as unknown);
    const wrapped = withMigration<{ x: number; fixed: boolean }>({ migrations })(inner);
    // 0 扱いで migration が走る
    await expect(wrapped.get("k")).resolves.toEqual({ x: 1, fixed: true });
  });
  // Infinity も不正値扱い (Number.isFinite false)
  it("treats Infinity as version 0", async () => {
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => ({ ...v, fixed: true }) },
    ];
    const inner = createMemoryStore<unknown>();
    await inner.set("k", { x: 1 });
    await inner.set("__version", Number.POSITIVE_INFINITY);
    const wrapped = withMigration<{ x: number; fixed: boolean }>({ migrations })(inner);
    await expect(wrapped.get("k")).resolves.toEqual({ x: 1, fixed: true });
  });
  // 空 migrations + 未保存値 → undefined
  it("empty migrations with latestVersion 0 still returns undefined for missing keys", async () => {
    const inner = createMemoryStore<unknown>();
    const wrapped = withMigration<unknown>({ migrations: [] })(inner);
    await expect(wrapped.get("nope")).resolves.toBeUndefined();
  });
  // 任意機能が無い inner では wrapped にも提供されない
  it("does not expose optional methods when inner lacks them", () => {
    const inner: KvStore<unknown> = {
      get: async () => undefined,
      set: async () => undefined,
      remove: async () => undefined,
    };
    const wrapped = withMigration<unknown>({ migrations: [] })(inner);
    expect(wrapped.has).toBeUndefined();
    expect(wrapped.keys).toBeUndefined();
    expect(wrapped.clear).toBeUndefined();
  });
  // version === latestVersion ではない中間バージョン (1) からの再開
  it("resumes migration from an intermediate version", async () => {
    // 0→1 と 1→2
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => ({ ...v, a: 1 }) },
      { fromVersion: 1, toVersion: 2, migrate: (v: any) => ({ ...v, b: 2 }) },
    ];
    const inner = createMemoryStore<unknown>();
    // v1 の値 (a を既に持つ) を保存
    await inner.set("k", { a: 1 });
    await inner.set("__version", 1);
    const wrapped = withMigration<{ a: number; b: number }>({ migrations })(inner);
    // 1→2 のみ適用される
    await expect(wrapped.get("k")).resolves.toEqual({ a: 1, b: 2 });
  });
});
