// vitest の API を取り込む
import { describe, expect, it } from "vitest";
// Node の URL→path 変換を取り込む
import { fileURLToPath } from "node:url";
// zod を取り込み (スキーマ生成用)
import { z } from "zod";
// 対象関数を取り込む
import { loadAndValidate, loadAndValidateSync } from "./validate.js";

// __fixtures__ 配下の相対パスを絶対パスに解決するヘルパ
function fixture(relative: string): string {
  // import.meta.url を基準に絶対パスを返す
  return fileURLToPath(new URL(`./__fixtures__/${relative}`, import.meta.url));
}

// 検証に使う簡易スキーマ (valid.json の最小サブセット)
const minimalSchema = z.object({
  // env は dev/staging/prod のいずれか
  env: z.enum(["dev", "staging", "prod"]),
});

// loadAndValidate の振る舞いを網羅するテスト
describe("loadAndValidate (async)", () => {
  // 正常時に T 型として値が返ることを確認
  it("returns validated value when schema matches", async () => {
    // 検証付きでロード
    const v = await loadAndValidate(fixture("valid.json"), minimalSchema);
    // env が想定値
    expect(v.env).toBe("dev");
  });

  // 検証失敗時に ZodError が透過することを確認
  it("propagates ZodError on validation failure", async () => {
    // 必須フィールドを欠いた別スキーマ
    const strict = z.object({ requiredField: z.string() });
    // valid.json には requiredField が無いので失敗
    await expect(loadAndValidate(fixture("valid.json"), strict)).rejects.toBeInstanceOf(z.ZodError);
  });
});

// loadAndValidateSync の振る舞いを網羅するテスト
describe("loadAndValidateSync", () => {
  // 同期で正常時に値が返る
  it("returns validated value when schema matches (sync)", () => {
    // 同期検証付きロード
    const v = loadAndValidateSync(fixture("valid.json"), minimalSchema);
    // env 確認
    expect(v.env).toBe("dev");
  });

  // 検証失敗時に ZodError が同期で投げられる
  it("throws ZodError on validation failure (sync)", () => {
    // 不一致スキーマ
    const strict = z.object({ requiredField: z.string() });
    // 例外を期待
    expect(() => loadAndValidateSync(fixture("valid.json"), strict)).toThrowError(z.ZodError);
  });
});
