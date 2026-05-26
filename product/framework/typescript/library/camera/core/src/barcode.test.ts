// vitest API
import { describe, expect, it } from "vitest";
// テスト対象
import { isBarcodeFormat, shouldEmitScan } from "./barcode.js";

describe("isBarcodeFormat", () => {
  // 正常値（全 13 種）
  it("既知の formats は true を返す", () => {
    for (const fmt of [
      "qr_code",
      "code_39",
      "code_93",
      "code_128",
      "codabar",
      "data_matrix",
      "ean_8",
      "ean_13",
      "itf",
      "pdf417",
      "upc_a",
      "upc_e",
      "aztec",
    ] as const) {
      expect(isBarcodeFormat(fmt)).toBe(true);
    }
  });

  // 異常値: 未知の文字列
  it("未知の文字列は false", () => {
    expect(isBarcodeFormat("UNKNOWN")).toBe(false);
  });

  // 異常値: 文字列以外（早期 false ブランチ）
  it("非文字列は false", () => {
    expect(isBarcodeFormat(123)).toBe(false);
    expect(isBarcodeFormat(null)).toBe(false);
    expect(isBarcodeFormat(undefined)).toBe(false);
    expect(isBarcodeFormat({})).toBe(false);
  });
});

describe("shouldEmitScan", () => {
  // 直前無し: 常に true
  it("previous が undefined のときは常に true", () => {
    expect(shouldEmitScan({ value: "x", scannedAt: 100 }, undefined, 1000)).toBe(true);
  });

  // throttleMs=0 のときは抑止しない
  it("throttleMs<=0 は常に true", () => {
    expect(
      shouldEmitScan(
        { value: "x", scannedAt: 100 },
        { value: "x", scannedAt: 99 },
        0,
      ),
    ).toBe(true);
    expect(
      shouldEmitScan(
        { value: "x", scannedAt: 100 },
        { value: "x", scannedAt: 99 },
        -1,
      ),
    ).toBe(true);
  });

  // 異なる value は常に true
  it("value が異なれば true", () => {
    expect(
      shouldEmitScan(
        { value: "a", scannedAt: 100 },
        { value: "b", scannedAt: 99 },
        1000,
      ),
    ).toBe(true);
  });

  // 同じ value で throttle 内は false
  it("同じ value かつ throttle 範囲内は false", () => {
    expect(
      shouldEmitScan(
        { value: "x", scannedAt: 100 },
        { value: "x", scannedAt: 50 },
        100,
      ),
    ).toBe(false);
  });

  // 同じ value で throttle 超え（等しい場合も含む）は true
  it("同じ value でも throttle 経過後は true", () => {
    expect(
      shouldEmitScan(
        { value: "x", scannedAt: 200 },
        { value: "x", scannedAt: 100 },
        100,
      ),
    ).toBe(true);
  });
});
