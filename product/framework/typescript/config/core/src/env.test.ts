// vitest の test/expect/describe を取り込み
import { describe, it, expect } from "vitest";
// テスト対象の関数を取り込み
import { mergeEnvConfig } from "./env.js";

// mergeEnvConfig の挙動をまとめてテスト
describe("mergeEnvConfig", () => {
  // dev は staging/prod 差分を無視してそのまま返す
  it("dev 環境は map.dev をそのまま返す", () => {
    // テスト用の設定マップを定義（dev は完全、staging/prod は差分）
    const map = {
      // dev はベース設定
      dev: { apiUrl: "http://localhost:3000", logLevel: "debug" },
      // staging の差分
      staging: { apiUrl: "https://stg.example.com" },
      // prod の差分
      prod: { apiUrl: "https://example.com", logLevel: "warn" },
    };
    // dev を指定した結果を取得
    const result = mergeEnvConfig(map, "dev");
    // dev の中身そのままが返ることを期待
    expect(result).toEqual({ apiUrl: "http://localhost:3000", logLevel: "debug" });
  });

  // staging では dev に staging 差分が浅くマージされる
  it("staging 環境は dev に staging 差分が上書きされる", () => {
    // テスト用設定マップ
    const map = {
      // dev のベース
      dev: { apiUrl: "http://localhost:3000", logLevel: "debug" },
      // staging で apiUrl のみ上書き
      staging: { apiUrl: "https://stg.example.com" },
      // prod は今回参照しない
      prod: {},
    };
    // staging を指定して取得
    const result = mergeEnvConfig(map, "staging");
    // logLevel は dev から継承、apiUrl は staging で上書き
    expect(result).toEqual({ apiUrl: "https://stg.example.com", logLevel: "debug" });
  });

  // prod も同様に差分マージされる
  it("prod 環境は dev に prod 差分が上書きされる", () => {
    // テスト用設定マップ
    const map = {
      // dev のベース
      dev: { apiUrl: "http://localhost:3000", logLevel: "debug" },
      // staging は参照しない
      staging: {},
      // prod で複数フィールド上書き
      prod: { apiUrl: "https://example.com", logLevel: "warn" },
    };
    // prod を指定
    const result = mergeEnvConfig(map, "prod");
    // 両フィールドとも prod 差分の値になる
    expect(result).toEqual({ apiUrl: "https://example.com", logLevel: "warn" });
  });

  // 差分が空オブジェクトでも dev そのままが返ることを保証
  it("staging 差分が空でも dev のコピーが返る", () => {
    // dev は完全、staging は空
    const map = {
      // dev のベース
      dev: { a: 1, b: 2 },
      // staging は空
      staging: {},
      // prod は参照しない
      prod: {},
    };
    // staging を指定
    const result = mergeEnvConfig(map, "staging");
    // dev と同等の中身を期待
    expect(result).toEqual({ a: 1, b: 2 });
  });

  // 返り値は新規オブジェクト（map.dev とは別参照）
  it("返り値は map.dev とは別参照の新規オブジェクト", () => {
    // dev のベース
    const dev = { x: 10 };
    // dev だけを使うマップ
    const map = { dev, staging: {}, prod: {} };
    // dev を指定して結果取得
    const result = mergeEnvConfig(map, "dev");
    // 中身は等価
    expect(result).toEqual(dev);
    // しかし参照は異なる（イミュータブル保証）
    expect(result).not.toBe(dev);
  });
});
