// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// ZodError を判定するため取り込み
import { ZodError } from "zod";
// テスト対象
import { envSchema, logLevelSchema, loggerConfigSchema, validateLoggerConfig } from "./schema.js";

describe("logLevelSchema / envSchema", () => {
  // 有効な値を通すこと
  it("有効な LogLevel を通す", () => {
    expect(logLevelSchema.parse("info")).toBe("info");
  });

  // 無効な値で ZodError
  it("無効な LogLevel で ZodError", () => {
    expect(() => logLevelSchema.parse("verbose")).toThrow(ZodError);
  });

  // 有効な Env
  it("有効な Env を通す", () => {
    expect(envSchema.parse("prod")).toBe("prod");
  });

  // 無効な Env で ZodError
  it("無効な Env で ZodError", () => {
    expect(() => envSchema.parse("local")).toThrow(ZodError);
  });
});

describe("loggerConfigSchema", () => {
  // 全フィールドを揃えた正常系
  it("正常系: 全フィールドを揃えて通る", () => {
    const result = loggerConfigSchema.parse({
      env: "dev",
      envLevels: { dev: "debug", staging: "info", prod: "warn" },
      defaultMinLevel: "info",
      tags: ["app"],
      context: { x: 1 },
    });
    expect(result.env).toBe("dev");
    expect(result.envLevels?.dev).toBe("debug");
    expect(result.tags).toEqual(["app"]);
  });

  // optional は省略可能
  it("env だけで通る（optional 省略可）", () => {
    const result = loggerConfigSchema.parse({ env: "prod" });
    expect(result.env).toBe("prod");
    expect(result.envLevels).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });

  // env が enum 外
  it("env が enum 外で ZodError", () => {
    expect(() => loggerConfigSchema.parse({ env: "local" })).toThrow(ZodError);
  });

  // envLevels.dev が LogLevel 外
  it("envLevels.dev が LogLevel 外で ZodError", () => {
    expect(() => loggerConfigSchema.parse({ env: "dev", envLevels: { dev: "loud" } })).toThrow(ZodError);
  });

  // defaultMinLevel が LogLevel 外
  it("defaultMinLevel が LogLevel 外で ZodError", () => {
    expect(() => loggerConfigSchema.parse({ env: "dev", defaultMinLevel: "loud" })).toThrow(ZodError);
  });

  // tags が配列でない
  it("tags が配列でないと ZodError", () => {
    expect(() => loggerConfigSchema.parse({ env: "dev", tags: "not-array" })).toThrow(ZodError);
  });

  // context が record でない
  it("context が object でないと ZodError", () => {
    expect(() => loggerConfigSchema.parse({ env: "dev", context: "x" })).toThrow(ZodError);
  });
});

describe("validateLoggerConfig", () => {
  // 失敗時に ZodError を throw
  it("失敗時に ZodError を throw する", () => {
    expect(() => validateLoggerConfig({ env: "nope" })).toThrow(ZodError);
  });

  // 成功時は parse 後の値を返す
  it("成功時に型確定の値を返す", () => {
    const v = validateLoggerConfig({ env: "dev" });
    expect(v.env).toBe("dev");
  });
});
