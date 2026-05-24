// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { appendSearchParams, encodeSearchParams, joinUrl } from "./url.js";

describe("encodeSearchParams", () => {
  // undefined / 空オブジェクト
  it("undefined は空文字", () => {
    expect(encodeSearchParams(undefined)).toBe("");
  });
  it("空オブジェクトは空文字", () => {
    expect(encodeSearchParams({})).toBe("");
  });
  // 基本値
  it("プリミティブ値を ? 付きで返す", () => {
    expect(encodeSearchParams({ a: 1, b: "x", c: true })).toBe("?a=1&b=x&c=true");
  });
  // null / undefined はスキップ
  it("null / undefined はスキップ", () => {
    expect(encodeSearchParams({ a: 1, b: null, c: undefined })).toBe("?a=1");
  });
  // 配列は複数 append
  it("配列値は要素ごとに append", () => {
    expect(encodeSearchParams({ tag: ["a", "b", "c"] })).toBe("?tag=a&tag=b&tag=c");
  });
});

describe("joinUrl", () => {
  // 絶対 URL は素通し
  it("absolute http URL は素通し", () => {
    expect(joinUrl("https://a", "http://b/x")).toBe("http://b/x");
    expect(joinUrl("https://a", "https://b/x")).toBe("https://b/x");
  });
  // baseUrl 未指定で path をそのまま
  it("baseUrl 未指定なら path をそのまま返す", () => {
    expect(joinUrl(undefined, "/local")).toBe("/local");
    expect(joinUrl("", "/local")).toBe("/local");
  });
  // 末尾スラッシュ吸収
  it("末尾スラッシュと先頭スラッシュの重複を吸収", () => {
    expect(joinUrl("https://a/", "/x")).toBe("https://a/x");
    expect(joinUrl("https://a", "x")).toBe("https://a/x");
    expect(joinUrl("https://a/", "x")).toBe("https://a/x");
    expect(joinUrl("https://a", "/x")).toBe("https://a/x");
  });
});

describe("appendSearchParams", () => {
  it("query が無ければ URL を変更しない", () => {
    expect(appendSearchParams("/users?active=true", undefined)).toBe(
      "/users?active=true",
    );
  });

  it("既存 query には & で追記する", () => {
    expect(appendSearchParams("/users?active=true", { page: 2 })).toBe(
      "/users?active=true&page=2",
    );
  });

  it("? / & で終わる URL には区切り文字を重複させない", () => {
    expect(appendSearchParams("/users?", { page: 2 })).toBe("/users?page=2");
    expect(appendSearchParams("/users?active=true&", { page: 2 })).toBe(
      "/users?active=true&page=2",
    );
  });

  it("hash fragment の前に query を追加する", () => {
    expect(appendSearchParams("/users#top", { page: 2 })).toBe("/users?page=2#top");
    expect(appendSearchParams("/users?active=true#top", { page: 2 })).toBe(
      "/users?active=true&page=2#top",
    );
  });
});
