// vitest API
import { describe, expect, it } from "vitest";
// テスト対象エラー群
import {
  CameraControlError,
  CameraError,
  CameraNotReadyError,
  DeviceUnavailableError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
} from "./errors.js";
// 型
import type { PermissionDescriptor } from "./types.js";

// 共通の descriptor
const descriptor: PermissionDescriptor = { camera: true };

// CameraError
describe("CameraError", () => {
  it("デフォルトの code / retryable で生成される", () => {
    // 既定 message 込み
    const err = new CameraError("oops");
    expect(err.code).toBe("CAMERA_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("CameraError");
    expect(err.message).toBe("oops");
  });

  it("code / retryable / cause を上書きできる", () => {
    // 原因例外を内包
    const cause = new Error("inner");
    const err = new CameraError("wrap", { code: "X_CUSTOM", retryable: true, cause });
    expect(err.code).toBe("X_CUSTOM");
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe(cause);
  });
});

// CameraNotReadyError
describe("CameraNotReadyError", () => {
  it("既定 message を持ち retryable は true", () => {
    const err = new CameraNotReadyError();
    expect(err.code).toBe("CAMERA_NOT_READY");
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("not started");
  });

  it("任意 message と cause を渡せる", () => {
    const cause = new Error("c");
    const err = new CameraNotReadyError("custom", { cause });
    expect(err.message).toBe("custom");
    expect(err.cause).toBe(cause);
  });
});

// PermissionDeniedError
describe("PermissionDeniedError", () => {
  it("既定で status=denied / retryable=true / 既定 message", () => {
    const err = new PermissionDeniedError(descriptor);
    expect(err.status).toBe("denied");
    expect(err.code).toBe("PERMISSION_DENIED");
    expect(err.retryable).toBe(true);
    expect(err.descriptor).toBe(descriptor);
    expect(err.message).toContain("denied");
  });

  it("blocked 指定で retryable=false / 既定 message が blocked 用", () => {
    const err = new PermissionDeniedError(descriptor, { status: "blocked" });
    expect(err.status).toBe("blocked");
    expect(err.code).toBe("PERMISSION_BLOCKED");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("blocked");
  });

  it("message と cause を上書きできる", () => {
    const cause = new Error("origin");
    const err = new PermissionDeniedError(descriptor, { message: "stop", cause });
    expect(err.message).toBe("stop");
    expect(err.cause).toBe(cause);
  });
});

// DeviceUnavailableError
describe("DeviceUnavailableError", () => {
  it("既定 message / retryable=false", () => {
    const err = new DeviceUnavailableError();
    expect(err.code).toBe("DEVICE_UNAVAILABLE");
    expect(err.retryable).toBe(false);
    expect(err.reason).toBeUndefined();
  });

  it("reason / retryable / cause / message を上書きできる", () => {
    const cause = new Error("hw");
    const err = new DeviceUnavailableError("custom", {
      reason: "WINDOWS_NOT_IMPLEMENTED",
      retryable: true,
      cause,
    });
    expect(err.reason).toBe("WINDOWS_NOT_IMPLEMENTED");
    expect(err.retryable).toBe(true);
    expect(err.message).toBe("custom");
    expect(err.cause).toBe(cause);
  });
});

// RecordingError
describe("RecordingError", () => {
  it("reason を元にした既定 message", () => {
    const err = new RecordingError("ALREADY_RECORDING");
    expect(err.code).toBe("RECORDING_ERROR");
    expect(err.reason).toBe("ALREADY_RECORDING");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("ALREADY_RECORDING");
  });

  it("message / retryable / cause を上書きできる", () => {
    const cause = new Error("mr");
    const err = new RecordingError("UNSUPPORTED_MIME", {
      message: "no codec",
      retryable: true,
      cause,
    });
    expect(err.message).toBe("no codec");
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe(cause);
  });
});

// ScannerError
describe("ScannerError", () => {
  it("reason を元にした既定 message", () => {
    const err = new ScannerError("ALREADY_SCANNING");
    expect(err.code).toBe("SCANNER_ERROR");
    expect(err.reason).toBe("ALREADY_SCANNING");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("ALREADY_SCANNING");
  });

  it("message / retryable / cause を上書きできる", () => {
    const cause = new Error("scan");
    const err = new ScannerError("UNSUPPORTED_FORMAT", {
      message: "fmt",
      retryable: true,
      cause,
    });
    expect(err.message).toBe("fmt");
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe(cause);
  });
});

// CameraControlError
describe("CameraControlError", () => {
  it("reason を元にした既定 message を持つ", () => {
    // UNSUPPORTED 固定
    const err = new CameraControlError("UNSUPPORTED");
    expect(err.code).toBe("CAMERA_CONTROL_ERROR");
    expect(err.reason).toBe("UNSUPPORTED");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("UNSUPPORTED");
  });

  it("message / retryable / cause を上書きできる", () => {
    // 原因例外を内包
    const cause = new Error("range");
    const err = new CameraControlError("OUT_OF_RANGE", {
      message: "zoom out",
      retryable: true,
      cause,
    });
    expect(err.message).toBe("zoom out");
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe(cause);
  });

  it("APPLY_FAILED 等の任意 reason を保持する", () => {
    // 動的 reason の利用例
    const err = new CameraControlError("APPLY_FAILED");
    expect(err.reason).toBe("APPLY_FAILED");
    expect(err.name).toBe("CameraControlError");
  });
});
