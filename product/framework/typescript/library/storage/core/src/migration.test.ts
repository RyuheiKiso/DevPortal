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

// envelope の判別子フィールド名 (migration.ts と同値、テスト内で envelope 検査に用いる)
const ENVELOPE_MARKER = "__k1s0_migration_envelope_v1__";

// inner から envelope に包まれた実値を取り出すテスト用ヘルパー
// migration.ts 側は envelope を内部実装として隠蔽するため、
// 「inner ストアに envelope が書かれている」ことを直接 assert するためのみに使う
function unwrapInnerValue(raw: unknown): unknown {
  // オブジェクトでなければそのまま (旧フォーマット想定)
  if (typeof raw !== "object" || raw === null) return raw;
  // マーカーフィールドを取得
  const marker = (raw as Record<string, unknown>)[ENVELOPE_MARKER];
  // envelope ならば value フィールドを取り出す
  if (typeof marker === "number") {
    return (raw as Record<string, unknown>)["value"];
  }
  // それ以外は素通し
  return raw;
}

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
  // 最新 version (= latestVersion と一致) はそのまま返却 (旧フォーマット読み込み)
  it("returns value as-is when version is already latest (legacy format)", async () => {
    // 2 ステップの migrations
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => ({ ...v, lang: "ja" }) },
      { fromVersion: 1, toVersion: 2, migrate: (v: any) => ({ ...v, theme: "light" }) },
    ];
    const inner = createMemoryStore<unknown>();
    // 旧フォーマット (raw value + 別キーで version) を直接書く
    await inner.set("preferences", { lang: "ja", theme: "light" });
    await inner.set("__version", 2);
    const wrapped = withMigration<{ lang: string; theme: string }>({ migrations })(inner);
    // get で migration は走らない (=値が変わらない)
    await expect(wrapped.get("preferences")).resolves.toEqual({ lang: "ja", theme: "light" });
  });
  // 2 ステップ適用 + 書き戻し (envelope 形式)
  it("applies migrations sequentially and writes back as envelope", async () => {
    // 0→1 と 1→2 の 2 ステップ
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => ({ ...v, lang: "ja" }) },
      { fromVersion: 1, toVersion: 2, migrate: (v: any) => ({ ...v, theme: "light" }) },
    ];
    const inner = createMemoryStore<unknown>();
    // v0 の値を旧フォーマットで直接書く (version キーは未設定 → 0 扱い)
    await inner.set("preferences", { user: "alice" });
    const wrapped = withMigration<{ user: string; lang: string; theme: string }>({ migrations })(inner);
    // get で 2 ステップ適用される
    await expect(wrapped.get("preferences")).resolves.toEqual({
      user: "alice",
      lang: "ja",
      theme: "light",
    });
    // 書き戻された envelope の中身を確認 (envelope 形式で保存されている)
    const stored = await inner.get("preferences");
    expect(unwrapInnerValue(stored)).toEqual({
      user: "alice",
      lang: "ja",
      theme: "light",
    });
    // versionKey は旧読み出し互換のためベストエフォート更新される
    await expect(inner.get("__version")).resolves.toBe(2);
    // wrapped.get 経由でも再度同じ値が返る (再 migration は走らない)
    await expect(wrapped.get("preferences")).resolves.toEqual({
      user: "alice",
      lang: "ja",
      theme: "light",
    });
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
  // onError="reset" + fallback あり (envelope で書き戻される)
  it("resets and writes fallback as envelope when onError is reset", async () => {
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
    // inner には envelope 形式で fallback が書き込まれている
    const stored = await inner.get("k");
    expect(unwrapInnerValue(stored)).toEqual({ v: "default" });
    // versionKey も最新へベストエフォート更新される
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
  // set は値と version を envelope で原子的に保存し、versionKey もベストエフォート更新する
  it("set writes value and version as a single envelope and updates versionKey", async () => {
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => v },
    ];
    const inner = createMemoryStore<unknown>();
    const wrapped = withMigration<{ x: number }>({ migrations })(inner);
    await wrapped.set("k", { x: 1 });
    // inner には envelope が書かれている (中身を unwrap して比較)
    const stored = await inner.get("k");
    expect(unwrapInnerValue(stored)).toEqual({ x: 1 });
    // 旧互換の versionKey もベストエフォート更新されている
    await expect(inner.get("__version")).resolves.toBe(1);
    // wrapped.get で読み戻し
    await expect(wrapped.get("k")).resolves.toEqual({ x: 1 });
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
    // v1 の値 (a を既に持つ) を旧フォーマットで保存
    await inner.set("k", { a: 1 });
    await inner.set("__version", 1);
    const wrapped = withMigration<{ a: number; b: number }>({ migrations })(inner);
    // 1→2 のみ適用される
    await expect(wrapped.get("k")).resolves.toEqual({ a: 1, b: 2 });
  });
  // envelope 形式の読み込み (= 既に envelope が書かれているケース)
  // version が一致するなら migration を実行せずそのまま返す
  it("reads back a previously envelope-stored value without migration", async () => {
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => ({ ...v, mig: true }) },
    ];
    const inner = createMemoryStore<unknown>();
    // wrapped.set 経由で envelope を書く
    const wrappedWrite = withMigration<{ a: number }>({ migrations })(inner);
    await wrappedWrite.set("k", { a: 1 });
    // 別の wrapped で読み戻しても migration は走らない (envelope 内バージョンが latest と一致)
    const wrappedRead = withMigration<{ a: number }>({ migrations })(inner);
    await expect(wrappedRead.get("k")).resolves.toEqual({ a: 1 });
  });
  // versionKey 書込みが失敗しても set の主処理 (envelope 書込み) は成功させる
  // envelope が canonical なので versionKey 失敗は黙殺してよい設計
  it("ignores versionKey write failure (envelope is canonical)", async () => {
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => v },
    ];
    // versionKey 書込みのみ失敗する mock store
    // 値キー (k) への書込みは成功するが、"__version" への書込みは throw する
    const backing = new Map<string, unknown>();
    const failingInner: KvStore<unknown> = {
      async get(key) {
        return backing.get(key);
      },
      async set(key, value) {
        if (key === "__version") throw new Error("simulated versionKey failure");
        backing.set(key, value);
      },
      async remove(key) {
        backing.delete(key);
      },
    };
    const wrapped = withMigration<{ x: number }>({ migrations })(failingInner);
    // set は throw しない (envelope は書けているのでデータ整合性は保たれる)
    await expect(wrapped.set("k", { x: 1 })).resolves.toBeUndefined();
    // wrapped.get で値を取り戻せる (envelope 内バージョンを参照するため versionKey 不要)
    await expect(wrapped.get("k")).resolves.toEqual({ x: 1 });
  });
  // 値書込み (envelope) が失敗した場合は set 自体が throw する (中間不整合は残らない)
  it("propagates the underlying error when envelope write fails", async () => {
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => v },
    ];
    // 値キーへの書込みが必ず失敗する mock store
    const backing = new Map<string, unknown>();
    const breakingInner: KvStore<unknown> = {
      async get(key) {
        return backing.get(key);
      },
      async set(key, value) {
        if (key !== "__version") throw new Error("simulated envelope write failure");
        backing.set(key, value);
      },
      async remove(key) {
        backing.delete(key);
      },
    };
    const wrapped = withMigration<{ x: number }>({ migrations })(breakingInner);
    // 値キー書込みが失敗するため、set 全体も throw する
    await expect(wrapped.set("k", { x: 1 })).rejects.toThrow(/envelope write failure/);
    // backing には値が残らない (中間不整合なし)
    expect(backing.has("k")).toBe(false);
  });
  // 保存値が null (object 型だが null) の場合は envelope と誤認せず生値として返す
  // isEnvelope の `raw === null` 分岐を網羅する
  it("treats stored null as a legacy raw value, not as envelope", async () => {
    const inner = createMemoryStore<unknown>();
    // 値として null を直接保存する (inner は KvStore<unknown> なので null も可)
    await inner.set("k", null);
    await inner.set("__version", 0);
    const wrapped = withMigration<unknown>({ migrations: [] })(inner);
    // 旧フォーマット扱い (currentVersion=0=latestVersion) なので null をそのまま返す
    await expect(wrapped.get("k")).resolves.toBeNull();
  });
  // 保存値が primitive (number 等) の場合も envelope ではない
  // isEnvelope の `typeof raw !== "object"` 分岐を網羅する
  it("treats stored primitive values as legacy (not envelope)", async () => {
    const inner = createMemoryStore<unknown>();
    // primitive を直接保存する
    await inner.set("k", 42);
    await inner.set("__version", 0);
    const wrapped = withMigration<unknown>({ migrations: [] })(inner);
    // primitive はそのまま返る
    await expect(wrapped.get("k")).resolves.toBe(42);
  });
  // envelope マーカーフィールドが number だが有限ではない (NaN / Infinity) 場合
  // isEnvelope の `Number.isFinite(marker)` 分岐を網羅する
  it("treats objects with non-finite marker as legacy (not envelope)", async () => {
    const inner = createMemoryStore<unknown>();
    // マーカーが Infinity の擬似 envelope オブジェクト (= 旧フォーマット扱いになるべき)
    await inner.set("k", { __k1s0_migration_envelope_v1__: Number.POSITIVE_INFINITY, value: { hidden: true } });
    await inner.set("__version", 0);
    const wrapped = withMigration<unknown>({ migrations: [] })(inner);
    // envelope ではないので、保存されたオブジェクトをそのまま返す (旧フォーマット読み出し)
    await expect(wrapped.get("k")).resolves.toEqual({
      __k1s0_migration_envelope_v1__: Number.POSITIVE_INFINITY,
      value: { hidden: true },
    });
  });
  // マイグレーション書き戻しがアトミック (= 1 回の inner.set) であることを検証
  it("writes migrated value as a single atomic envelope (one inner.set call)", async () => {
    const migrations: Migration[] = [
      { fromVersion: 0, toVersion: 1, migrate: (v: any) => ({ ...v, mig: true }) },
    ];
    // inner.set の呼び出しキーを記録する spy store
    const backing = new Map<string, unknown>();
    const setCalls: Array<{ key: string; value: unknown }> = [];
    const spyInner: KvStore<unknown> = {
      async get(key) {
        return backing.get(key);
      },
      async set(key, value) {
        setCalls.push({ key, value });
        backing.set(key, value);
      },
      async remove(key) {
        backing.delete(key);
      },
    };
    // 旧フォーマットの値を直接 backing に書く (spy 記録には含めない)
    backing.set("k", { a: 1 });
    const wrapped = withMigration<{ a: number; mig: boolean }>({ migrations })(spyInner);
    // get がマイグレーションを実行する
    await expect(wrapped.get("k")).resolves.toEqual({ a: 1, mig: true });
    // 値キーへの書込みは厳密に 1 回 (envelope 1 つで完結)
    const valueWrites = setCalls.filter((c) => c.key === "k");
    expect(valueWrites).toHaveLength(1);
    // 書き込まれた値は envelope 形式 (= マーカーフィールドを持つ)
    const w = valueWrites[0]!.value;
    expect(typeof w === "object" && w !== null && ENVELOPE_MARKER in (w as object)).toBe(true);
  });
});
