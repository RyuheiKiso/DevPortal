// vitest API
import { describe, expect, it } from "vitest";
// テスト対象
import {
  barcodeFormatSchema,
  cameraFacingSchema,
  cameraManagerConfigSchema,
  cameraResolutionSchema,
  permissionDescriptorSchema,
  photoOptionsSchema,
  previewConfigSchema,
  recordingOptionsSchema,
  scannerConfigSchema,
  validateCameraConfig,
} from "./schema.js";

describe("cameraFacingSchema", () => {
  it("front/back/external を受理", () => {
    expect(cameraFacingSchema.parse("front")).toBe("front");
    expect(cameraFacingSchema.parse("back")).toBe("back");
    expect(cameraFacingSchema.parse("external")).toBe("external");
  });

  it("未知の値は ZodError", () => {
    expect(() => cameraFacingSchema.parse("other")).toThrow();
  });
});

describe("cameraResolutionSchema", () => {
  it("正の整数の幅高さを受理", () => {
    expect(cameraResolutionSchema.parse({ width: 1920, height: 1080 })).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("負値は拒否", () => {
    expect(() => cameraResolutionSchema.parse({ width: -1, height: 1 })).toThrow();
  });
});

describe("photoOptionsSchema", () => {
  it("全フィールド任意で空オブジェクトも受理", () => {
    expect(photoOptionsSchema.parse({})).toEqual({});
  });

  it("品質と mimeType の境界を検証", () => {
    expect(photoOptionsSchema.parse({ quality: 0, mimeType: "image/png" })).toEqual({
      quality: 0,
      mimeType: "image/png",
    });
    expect(() => photoOptionsSchema.parse({ quality: 1.5 })).toThrow();
    expect(() => photoOptionsSchema.parse({ mimeType: "image/webp" })).toThrow();
  });
});

describe("recordingOptionsSchema", () => {
  it("全フィールド任意で空でも OK", () => {
    expect(recordingOptionsSchema.parse({})).toEqual({});
  });

  it("正の整数を要求", () => {
    expect(recordingOptionsSchema.parse({ maxDurationMs: 1000 })).toEqual({
      maxDurationMs: 1000,
    });
    expect(() => recordingOptionsSchema.parse({ maxDurationMs: 0 })).toThrow();
    expect(() => recordingOptionsSchema.parse({ maxFileSizeBytes: -1 })).toThrow();
    expect(() => recordingOptionsSchema.parse({ videoBitsPerSecond: -1 })).toThrow();
  });
});

describe("barcodeFormatSchema", () => {
  it("qr_code を受理", () => {
    expect(barcodeFormatSchema.parse("qr_code")).toBe("qr_code");
  });
  it("未知値は拒否", () => {
    expect(() => barcodeFormatSchema.parse("unknown")).toThrow();
  });
});

describe("scannerConfigSchema", () => {
  it("空オブジェクトも受理", () => {
    expect(scannerConfigSchema.parse({})).toEqual({});
  });

  it("formats が空配列は拒否", () => {
    expect(() => scannerConfigSchema.parse({ formats: [] })).toThrow();
  });

  it("region の 0-1 範囲外を拒否", () => {
    expect(() =>
      scannerConfigSchema.parse({ region: { x: 1.1, y: 0, width: 0.5, height: 0.5 } }),
    ).toThrow();
  });

  it("有効な region を受理", () => {
    expect(
      scannerConfigSchema.parse({ region: { x: 0, y: 0, width: 1, height: 1 } }),
    ).toEqual({ region: { x: 0, y: 0, width: 1, height: 1 } });
  });
});

describe("previewConfigSchema", () => {
  it("空オブジェクトを受理", () => {
    expect(previewConfigSchema.parse({})).toEqual({});
  });
  it("deviceId 空文字は拒否", () => {
    expect(() => previewConfigSchema.parse({ deviceId: "" })).toThrow();
  });
  it("frameRate <=0 は拒否", () => {
    expect(() => previewConfigSchema.parse({ frameRate: 0 })).toThrow();
  });
});

describe("cameraManagerConfigSchema / validateCameraConfig", () => {
  it("空オブジェクトを受理", () => {
    expect(cameraManagerConfigSchema.parse({})).toEqual({});
    expect(validateCameraConfig({})).toEqual({});
  });
  it("now が関数なら受理", () => {
    const now = () => 0;
    const result = cameraManagerConfigSchema.parse({ now });
    expect(typeof result.now).toBe("function");
  });
  it("now が非関数は拒否", () => {
    expect(() => validateCameraConfig({ now: 123 })).toThrow();
  });
});

describe("permissionDescriptorSchema", () => {
  it("camera=true のみで OK", () => {
    expect(permissionDescriptorSchema.parse({ camera: true })).toEqual({ camera: true });
  });
  it("microphone / mediaLibrary を任意に持てる", () => {
    expect(
      permissionDescriptorSchema.parse({ camera: true, microphone: true, mediaLibrary: false }),
    ).toEqual({ camera: true, microphone: true, mediaLibrary: false });
  });
});
