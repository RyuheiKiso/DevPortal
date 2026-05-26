// vitest API
import { describe, expect, it } from "vitest";
// テスト対象
import {
  canRequestPermission,
  isPermissionGranted,
  shouldOpenSettings,
} from "./permission.js";

// permission 判定ヘルパのテスト
describe("permission helpers", () => {
  // isPermissionGranted: granted のみ true
  it("isPermissionGranted は granted のみ true", () => {
    expect(isPermissionGranted("granted")).toBe(true);
    expect(isPermissionGranted("denied")).toBe(false);
    expect(isPermissionGranted("prompt")).toBe(false);
    expect(isPermissionGranted("blocked")).toBe(false);
    expect(isPermissionGranted("unavailable")).toBe(false);
  });

  // canRequestPermission: prompt / denied で true
  it("canRequestPermission は prompt / denied のみ true", () => {
    expect(canRequestPermission("prompt")).toBe(true);
    expect(canRequestPermission("denied")).toBe(true);
    expect(canRequestPermission("granted")).toBe(false);
    expect(canRequestPermission("blocked")).toBe(false);
    expect(canRequestPermission("unavailable")).toBe(false);
  });

  // shouldOpenSettings: blocked のみ true
  it("shouldOpenSettings は blocked のみ true", () => {
    expect(shouldOpenSettings("blocked")).toBe(true);
    expect(shouldOpenSettings("granted")).toBe(false);
    expect(shouldOpenSettings("denied")).toBe(false);
    expect(shouldOpenSettings("prompt")).toBe(false);
    expect(shouldOpenSettings("unavailable")).toBe(false);
  });
});
