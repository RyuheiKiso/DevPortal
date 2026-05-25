// vitest DSL を取り込み
import { beforeEach, describe, expect, it, vi } from "vitest";
// core の Transport 型を取り込み
import type { Transport } from "@k1s0-ts-logger/core";

// テスト前にモジュールキャッシュをリセットして Platform.OS を切り替えられるようにする
beforeEach(() => {
  // 直前テストの dynamic import を破棄
  vi.resetModules();
});

// 任意の Platform.OS でモジュールをロードする小ヘルパ
async function loadPlatformFor(os: string) {
  // react-native のモックを差し替え
  vi.doMock("react-native", () => ({ Platform: { OS: os } }));
  // 動的 import でモック反映後の platform.ts を取り込み
  return await import("./platform.js");
}

// 識別可能なダミー transport を生成
function makeTransport(name: string): Transport {
  // 最低限の Transport 形状（write のみ実装）
  return {
    // 識別名
    name,
    // 何もしない write
    write: vi.fn(),
  };
}

// resolvePlatformTransports のテスト
describe("resolvePlatformTransports", () => {
  // ios で ios 用 transports が返ること
  it("Platform.OS が ios のときは ios の transports を返す", async () => {
    // ios として読み込み
    const { resolvePlatformTransports } = await loadPlatformFor("ios");
    // 共通と ios を別物にしておく
    const defaultT = [makeTransport("default")];
    const iosT = [makeTransport("ios")];
    // resolve
    const out = resolvePlatformTransports({ default: defaultT, ios: iosT });
    // ios のものが返ること
    expect(out).toBe(iosT);
  });

  // ios でも ios 未指定なら default が返ること
  it("ios で ios 未指定の場合は default を返す", async () => {
    // ios として読み込み
    const { resolvePlatformTransports } = await loadPlatformFor("ios");
    // 共通のみ
    const defaultT = [makeTransport("default")];
    // resolve
    const out = resolvePlatformTransports({ default: defaultT });
    // default が返ること
    expect(out).toBe(defaultT);
  });

  // android で android 用 transports が返ること
  it("Platform.OS が android のときは android の transports を返す", async () => {
    // android として読み込み
    const { resolvePlatformTransports } = await loadPlatformFor("android");
    // 共通と android を別物
    const defaultT = [makeTransport("default")];
    const androidT = [makeTransport("android")];
    // resolve
    const out = resolvePlatformTransports({ default: defaultT, android: androidT });
    // android のものが返ること
    expect(out).toBe(androidT);
  });

  // android でも未指定なら default
  it("android で android 未指定の場合は default を返す", async () => {
    // android として読み込み
    const { resolvePlatformTransports } = await loadPlatformFor("android");
    // 共通のみ
    const defaultT = [makeTransport("default")];
    // resolve
    const out = resolvePlatformTransports({ default: defaultT });
    // default が返ること
    expect(out).toBe(defaultT);
  });

  // windows で windows 用が返ること
  it("Platform.OS が windows のときは windows の transports を返す", async () => {
    // windows として読み込み
    const { resolvePlatformTransports } = await loadPlatformFor("windows");
    // 共通と windows を別物
    const defaultT = [makeTransport("default")];
    const winT = [makeTransport("windows")];
    // resolve
    const out = resolvePlatformTransports({ default: defaultT, windows: winT });
    // windows のものが返ること
    expect(out).toBe(winT);
  });

  // windows でも未指定なら default
  it("windows で windows 未指定の場合は default を返す", async () => {
    // windows として読み込み
    const { resolvePlatformTransports } = await loadPlatformFor("windows");
    // 共通のみ
    const defaultT = [makeTransport("default")];
    // resolve
    const out = resolvePlatformTransports({ default: defaultT });
    // default が返ること
    expect(out).toBe(defaultT);
  });

  // macos で macos 用が返ること
  it("Platform.OS が macos のときは macos の transports を返す", async () => {
    // macos として読み込み
    const { resolvePlatformTransports } = await loadPlatformFor("macos");
    // 共通と macos を別物
    const defaultT = [makeTransport("default")];
    const macT = [makeTransport("macos")];
    // resolve
    const out = resolvePlatformTransports({ default: defaultT, macos: macT });
    // macos のものが返ること
    expect(out).toBe(macT);
  });

  // macos でも未指定なら default
  it("macos で macos 未指定の場合は default を返す", async () => {
    // macos として読み込み
    const { resolvePlatformTransports } = await loadPlatformFor("macos");
    // 共通のみ
    const defaultT = [makeTransport("default")];
    // resolve
    const out = resolvePlatformTransports({ default: defaultT });
    // default が返ること
    expect(out).toBe(defaultT);
  });

  // その他（web 等）は default を返すこと
  it("Platform.OS が switch に無い値のときは default を返す", async () => {
    // web として読み込み
    const { resolvePlatformTransports } = await loadPlatformFor("web");
    // 共通のみ
    const defaultT = [makeTransport("default")];
    // resolve
    const out = resolvePlatformTransports({ default: defaultT });
    // default が返ること
    expect(out).toBe(defaultT);
  });
});
