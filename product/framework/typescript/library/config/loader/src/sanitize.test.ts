// vitest の API を取り込む
import { describe, expect, it } from "vitest";
// 対象関数を取り込む
import { stripDangerousKeys } from "./sanitize.js";

// stripDangerousKeys の振る舞いを網羅するテスト
describe("stripDangerousKeys", () => {
  // プリミティブはそのまま通過
  it("primitives pass through unchanged", () => {
    // 各プリミティブを順に検証
    expect(stripDangerousKeys(1)).toBe(1);
    expect(stripDangerousKeys("x")).toBe("x");
    expect(stripDangerousKeys(true)).toBe(true);
    expect(stripDangerousKeys(null)).toBe(null);
    expect(stripDangerousKeys(undefined)).toBe(undefined);
  });

  // 危険キー（__proto__/constructor/prototype）が除去されること
  it("removes __proto__ / constructor / prototype keys", () => {
    // ハッシュ表に危険キーを混在させる
    const input = { __proto__: { x: 1 }, constructor: 2, prototype: 3, ok: 4 } as Record<string, unknown>;
    // 浄化結果を取得
    const result = stripDangerousKeys(input) as Record<string, unknown>;
    // 危険キーは存在しない
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, "prototype")).toBe(false);
    // 正常キーは保持される
    expect(result.ok).toBe(4);
    // 結果オブジェクトのプロトタイプは標準 Object.prototype のまま
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  // ネストの危険キーも再帰的に除去されること
  it("removes dangerous keys recursively in nested objects", () => {
    // ネストオブジェクトに危険キーを含む
    const input = { nested: { __proto__: { evil: true }, good: 1 } } as Record<string, unknown>;
    // 浄化結果
    const result = stripDangerousKeys(input) as { nested: Record<string, unknown> };
    // ネスト先の __proto__ も除去
    expect(Object.prototype.hasOwnProperty.call(result.nested, "__proto__")).toBe(false);
    // 正常キーは保持
    expect(result.nested.good).toBe(1);
  });

  // 配列の中の危険キーも除去されること
  it("removes dangerous keys inside arrays", () => {
    // 配列要素のオブジェクトに危険キーを含む
    const input = { items: [{ __proto__: { e: 1 }, name: "a" }, { name: "b" }] };
    // 浄化
    const result = stripDangerousKeys(input) as { items: Array<Record<string, unknown>> };
    // 配列要素の __proto__ も除去
    expect(Object.prototype.hasOwnProperty.call(result.items[0], "__proto__")).toBe(false);
    // 正常キーは保持
    expect(result.items[0].name).toBe("a");
    expect(result.items[1].name).toBe("b");
  });

  // Date インスタンスは型情報を保持して返ること
  it("preserves Date instances (does not flatten to {})", () => {
    // 既知の時刻を持つ Date
    const date = new Date("2024-01-01T00:00:00Z");
    // 入力に組み込む
    const input = { releasedAt: date, name: "v1" };
    // 浄化
    const result = stripDangerousKeys(input) as { releasedAt: Date; name: string };
    // Date のメソッドが呼べる（=型情報が保持されている）
    expect(result.releasedAt).toBeInstanceOf(Date);
    expect(result.releasedAt.getTime()).toBe(date.getTime());
    // 同一参照（特殊型は浅いコピーせず保持）
    expect(result.releasedAt).toBe(date);
  });

  // Map / Set / RegExp も型情報を保持して返ること
  it("preserves Map / Set / RegExp instances", () => {
    // 各特殊型インスタンス
    const map = new Map<string, number>([["k", 1]]);
    const set = new Set([1, 2, 3]);
    const re = /abc/g;
    // 入力に組み込む
    const input = { map, set, re };
    // 浄化
    const result = stripDangerousKeys(input) as { map: Map<string, number>; set: Set<number>; re: RegExp };
    // 型情報・参照ともに保持
    expect(result.map).toBe(map);
    expect(result.set).toBe(set);
    expect(result.re).toBe(re);
  });

  // ArrayBuffer / TypedArray も型情報を保持
  it("preserves ArrayBuffer / TypedArray instances", () => {
    // 8 byte の Uint8Array
    const u8 = new Uint8Array([1, 2, 3]);
    // 入力
    const input = { bin: u8 };
    // 浄化
    const result = stripDangerousKeys(input) as { bin: Uint8Array };
    // 型と参照を保持
    expect(result.bin).toBe(u8);
    expect(result.bin).toBeInstanceOf(Uint8Array);
  });

  // 循環参照を含むオブジェクトでも stack overflow しない
  it("handles cyclic plain objects without stack overflow", () => {
    // 自己参照オブジェクト
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    // 浄化（無限再帰しないこと）
    const result = stripDangerousKeys(a) as Record<string, unknown>;
    // name は保持
    expect(result.name).toBe("a");
    // self はサイクル節点として元の a 参照のまま戻る（新規 walk 結果のキーには登録されている）
    // 浄化後の参照同一性は要求しないが、stack overflow しないことが本テストの主目的
    expect(result).toBeDefined();
  });

  // 循環参照を含む配列でも stack overflow しない
  it("handles cyclic arrays without stack overflow", () => {
    // 自己参照配列
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    // 浄化
    const result = stripDangerousKeys(arr) as unknown[];
    // 要素数は元の長さを保持
    expect(result.length).toBe(3);
    // 循環参照ノードはそのまま arr 参照で戻る
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(2);
  });

  // Object.prototype を実際に汚染しようと試みても影響しないこと
  it("does not pollute Object.prototype when input contains __proto__", () => {
    // 攻撃文字列を JSON 経由で取り込んだ想定の入力（own 列挙可能 __proto__）
    const malicious = JSON.parse('{"__proto__":{"polluted":true},"ok":1}');
    // 浄化
    stripDangerousKeys(malicious);
    // 素のオブジェクトに polluted が漏れていないこと
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // Object.prototype 自体も無汚染
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
  });
});
