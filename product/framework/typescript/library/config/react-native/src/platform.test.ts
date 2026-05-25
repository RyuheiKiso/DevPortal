// vitest DSL を取り込み
import { beforeEach, describe, expect, it, vi } from "vitest";

// 各テスト前にモジュールキャッシュをリセットして Platform を切り替え可能にする
beforeEach(() => {
  // 直前テストで dynamic import したモジュールを破棄
  vi.resetModules();
});

// 任意の Platform.OS でモジュールをロードする小ヘルパ
async function loadPlatformFor(os: string) {
  // react-native の Platform を都度モックし直す
  vi.doMock("react-native", () => ({ Platform: { OS: os } }));
  // 動的 import でモック反映後の platform.ts を取り込み
  return await import("./platform.js");
}

// テスト対象の型を取り込み（型のみなのでモック対象外）
import type { PlatformConfigMap } from "./platform.js";

// テスト用の設定型
interface TestConfig {
  // ベースカラー
  color: string;
  // タイムアウト
  timeoutMs: number;
}

// すべての分岐を網羅できる map を作る
function makeMap(): PlatformConfigMap<TestConfig> {
  // default + 各 OS の差分を全部入れる
  return {
    // 既定値
    default: { color: "#default", timeoutMs: 1000 },
    // iOS のみ color を上書き
    ios: { color: "#ios" },
    // Android のみ timeoutMs を上書き
    android: { timeoutMs: 2000 },
    // Windows のみ color を上書き
    windows: { color: "#windows" },
    // macOS のみ color を上書き
    macos: { color: "#macos" },
  };
}

// mergePlatformConfig のテスト
describe("mergePlatformConfig", () => {
  // Platform.OS=ios の場合は ios overrides が適用されること
  it("Platform.OS が ios のとき ios overrides をマージする", async () => {
    // ios として platform.ts を読み込む
    const { mergePlatformConfig } = await loadPlatformFor("ios");
    // マージ結果を取得
    const merged = mergePlatformConfig(makeMap());
    // ios の color が反映されている
    expect(merged.color).toBe("#ios");
    // timeoutMs は default のまま
    expect(merged.timeoutMs).toBe(1000);
  });

  // Platform.OS=android の場合は android overrides が適用されること
  it("Platform.OS が android のとき android overrides をマージする", async () => {
    // android として platform.ts を読み込む
    const { mergePlatformConfig } = await loadPlatformFor("android");
    // マージ結果を取得
    const merged = mergePlatformConfig(makeMap());
    // color は default のまま
    expect(merged.color).toBe("#default");
    // android の timeoutMs が反映されている
    expect(merged.timeoutMs).toBe(2000);
  });

  // Platform.OS=windows の場合は windows overrides が適用されること
  it("Platform.OS が windows のとき windows overrides をマージする", async () => {
    // windows として platform.ts を読み込む
    const { mergePlatformConfig } = await loadPlatformFor("windows");
    // マージ結果を取得
    const merged = mergePlatformConfig(makeMap());
    // windows の color が反映されている
    expect(merged.color).toBe("#windows");
    // timeoutMs は default のまま
    expect(merged.timeoutMs).toBe(1000);
  });

  // Platform.OS=macos の場合は macos overrides が適用されること
  it("Platform.OS が macos のとき macos overrides をマージする", async () => {
    // macos として platform.ts を読み込む
    const { mergePlatformConfig } = await loadPlatformFor("macos");
    // マージ結果を取得
    const merged = mergePlatformConfig(makeMap());
    // macos の color が反映されている
    expect(merged.color).toBe("#macos");
    // timeoutMs は default のまま
    expect(merged.timeoutMs).toBe(1000);
  });

  // 該当 OS の差分が無い場合は default のみが採用されること（web 等のフォールバック分岐）
  it("Platform.OS が対応マップに無い場合は default のみを返す", async () => {
    // web として platform.ts を読み込む
    const { mergePlatformConfig } = await loadPlatformFor("web");
    // 差分の無いマップを使う（default だけ）
    const merged = mergePlatformConfig<TestConfig>({
      // default のみ
      default: { color: "#only-default", timeoutMs: 9999 },
    });
    // default の値がそのまま返ること
    expect(merged.color).toBe("#only-default");
    // default の値がそのまま返ること
    expect(merged.timeoutMs).toBe(9999);
  });
});
