// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// テスト対象
import {
  notificationLevelSchema,
  notificationConfigSchema,
  validateNotificationConfig,
} from "./schema.js";

describe("schema", () => {
  // 通知レベルの正しい値は受理される
  it("notificationLevelSchema は info/success/warning/error を受理する", () => {
    expect(notificationLevelSchema.parse("info")).toBe("info");
    expect(notificationLevelSchema.parse("success")).toBe("success");
    expect(notificationLevelSchema.parse("warning")).toBe("warning");
    expect(notificationLevelSchema.parse("error")).toBe("error");
  });

  // 未知のレベルは reject
  it("不明なレベル文字列は reject", () => {
    expect(() => notificationLevelSchema.parse("unknown")).toThrow();
  });

  // 設定スキーマの正常系
  it("notificationConfigSchema は defaultDuration / maxQueueSize を許容する", () => {
    const parsed = notificationConfigSchema.parse({
      defaultDuration: 3000,
      maxQueueSize: 50,
    });
    expect(parsed.defaultDuration).toBe(3000);
    expect(parsed.maxQueueSize).toBe(50);
  });

  // 空オブジェクトも受理（任意フィールドのみのため）
  it("notificationConfigSchema は空オブジェクトを受理する", () => {
    const parsed = notificationConfigSchema.parse({});
    expect(parsed.defaultDuration).toBeUndefined();
    expect(parsed.maxQueueSize).toBeUndefined();
  });

  // 不正な値は reject される
  it("負の defaultDuration は reject", () => {
    expect(() => notificationConfigSchema.parse({ defaultDuration: -10 })).toThrow();
  });

  // 0 以下の maxQueueSize は reject される
  it("0 以下の maxQueueSize は reject", () => {
    expect(() => notificationConfigSchema.parse({ maxQueueSize: 0 })).toThrow();
  });

  // validateNotificationConfig ヘルパが parse の薄いラッパとして動く
  it("validateNotificationConfig は parse と等価", () => {
    expect(validateNotificationConfig({ defaultDuration: 5000 })).toEqual({
      defaultDuration: 5000,
    });
  });
});
