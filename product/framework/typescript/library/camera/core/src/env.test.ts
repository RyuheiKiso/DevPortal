// vitest API
import { afterEach, describe, expect, it, vi } from "vitest";
// テスト対象
import { getNodeEnv, isDevelopment, isProduction } from "./env.js";

// 各テスト後に global stub を片付ける
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getNodeEnv", () => {
  it("process.env.NODE_ENV が読める場合はそれを返す", () => {
    vi.stubGlobal("process", { env: { NODE_ENV: "production" } });
    expect(getNodeEnv()).toBe("production");
  });

  it("process が無い場合は undefined", () => {
    vi.stubGlobal("process", undefined);
    expect(getNodeEnv()).toBeUndefined();
  });

  it("getter が throw する場合は undefined にフォールバック", () => {
    // process プロパティを Proxy で throw させる
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );
    vi.stubGlobal("process", trap);
    expect(getNodeEnv()).toBeUndefined();
  });
});

describe("isProduction", () => {
  it("production のときのみ true", () => {
    vi.stubGlobal("process", { env: { NODE_ENV: "production" } });
    expect(isProduction()).toBe(true);
    vi.stubGlobal("process", { env: { NODE_ENV: "development" } });
    expect(isProduction()).toBe(false);
  });
});

describe("isDevelopment", () => {
  it("NODE_ENV が production なら false（__DEV__ が true でも覆さない）", () => {
    vi.stubGlobal("process", { env: { NODE_ENV: "production" } });
    vi.stubGlobal("__DEV__", true);
    expect(isDevelopment()).toBe(false);
  });

  it("NODE_ENV が development なら true", () => {
    vi.stubGlobal("process", { env: { NODE_ENV: "development" } });
    vi.stubGlobal("__DEV__", undefined);
    expect(isDevelopment()).toBe(true);
  });

  it("__DEV__ が true なら true", () => {
    vi.stubGlobal("process", { env: { NODE_ENV: undefined } });
    vi.stubGlobal("__DEV__", true);
    expect(isDevelopment()).toBe(true);
  });

  it("どれにも該当しない場合は false", () => {
    vi.stubGlobal("process", { env: { NODE_ENV: "test" } });
    vi.stubGlobal("__DEV__", false);
    expect(isDevelopment()).toBe(false);
  });
});
