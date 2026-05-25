// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import { isJsonContentType, isJsonSerializableBody } from "./json.js";

describe("isJsonContentType", () => {
  // 未指定
  it("undefined は false", () => {
    expect(isJsonContentType(undefined)).toBe(false);
  });
  // application/json
  it("application/json は true", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
  });
  // +json サフィックス
  it("+json サフィックスは true（vnd.api+json 等）", () => {
    expect(isJsonContentType("application/vnd.api+json")).toBe(true);
  });
  // その他は false
  it("text/plain は false", () => {
    expect(isJsonContentType("text/plain")).toBe(false);
  });
});

describe("isJsonSerializableBody", () => {
  // null / undefined
  it("null / undefined は false", () => {
    expect(isJsonSerializableBody(null)).toBe(false);
    expect(isJsonSerializableBody(undefined)).toBe(false);
  });
  // 文字列
  it("文字列は false（既に BodyInit）", () => {
    expect(isJsonSerializableBody("abc")).toBe(false);
  });
  // FormData
  it("FormData は false", () => {
    expect(isJsonSerializableBody(new FormData())).toBe(false);
  });
  // Blob
  it("Blob は false", () => {
    expect(isJsonSerializableBody(new Blob(["x"]))).toBe(false);
  });
  // ArrayBuffer / TypedArray
  it("ArrayBuffer / TypedArray は false", () => {
    expect(isJsonSerializableBody(new ArrayBuffer(8))).toBe(false);
    expect(isJsonSerializableBody(new Uint8Array(4))).toBe(false);
  });
  // ReadableStream
  it("ReadableStream は false", () => {
    expect(isJsonSerializableBody(new ReadableStream())).toBe(false);
  });
  // URLSearchParams
  it("URLSearchParams は false", () => {
    expect(isJsonSerializableBody(new URLSearchParams({ a: "1" }))).toBe(false);
  });
  // plain object
  it("plain object は true", () => {
    expect(isJsonSerializableBody({ a: 1 })).toBe(true);
  });
  // 配列
  it("配列は true", () => {
    expect(isJsonSerializableBody([1, 2])).toBe(true);
  });
});
