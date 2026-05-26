// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// テスト対象
import { defaultBarcodeDetectorFactory } from "./barcodeDetector.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defaultBarcodeDetectorFactory", () => {
  it("global BarcodeDetector が無いと throw する", () => {
    vi.stubGlobal("BarcodeDetector", undefined);
    expect(() => defaultBarcodeDetectorFactory(["qr_code"])).toThrow(
      /BarcodeDetector is not available/,
    );
  });

  it("global BarcodeDetector があればインスタンス化", () => {
    const detectMock = vi.fn();
    class FakeBD {
      // formats を保持
      formats: readonly string[];
      // detect は mock
      detect = detectMock;
      constructor(init: { formats: readonly string[] }) {
        this.formats = init.formats;
      }
    }
    vi.stubGlobal("BarcodeDetector", FakeBD);
    const detector = defaultBarcodeDetectorFactory(["qr_code", "code_128"]);
    expect((detector as unknown as FakeBD).formats).toEqual(["qr_code", "code_128"]);
  });
});
