// vitest DSL を取り込み
import { beforeEach, describe, expect, it, vi } from "vitest";

// 各テスト前にモジュールキャッシュをリセットして Platform.OS を切り替え可能にする
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

// 識別子付きの fetch スタブ
function makeFetch(label: string): typeof fetch {
  // 戻り値は使わないが label を埋めた Response を返す
  return vi.fn(async () => new Response(label)) as unknown as typeof fetch;
}

// resolvePlatformFetch のテスト
describe("resolvePlatformFetch", () => {
  // Platform.OS = ios のとき ios の fetch を返す
  it("Platform.OS が ios のとき ios の fetch を返す", async () => {
    // ios として読み込む
    const { resolvePlatformFetch } = await loadPlatformFor("ios");
    // 各 OS の fetch
    const defaultFetch = makeFetch("default");
    const iosFetch = makeFetch("ios");
    // resolve
    expect(resolvePlatformFetch({ default: defaultFetch, ios: iosFetch })).toBe(iosFetch);
  });

  // ios でも ios 未指定なら default を返す
  it("ios で ios 未指定の場合は default を返す", async () => {
    // ios として読み込む
    const { resolvePlatformFetch } = await loadPlatformFor("ios");
    // default のみ
    const defaultFetch = makeFetch("default");
    // resolve
    expect(resolvePlatformFetch({ default: defaultFetch })).toBe(defaultFetch);
  });

  // Platform.OS = android のとき android の fetch を返す
  it("Platform.OS が android のとき android の fetch を返す", async () => {
    // android として読み込む
    const { resolvePlatformFetch } = await loadPlatformFor("android");
    // 各 OS の fetch
    const defaultFetch = makeFetch("default");
    const androidFetch = makeFetch("android");
    // resolve
    expect(resolvePlatformFetch({ default: defaultFetch, android: androidFetch })).toBe(
      androidFetch,
    );
  });

  // android でも android 未指定なら default を返す
  it("android で android 未指定の場合は default を返す", async () => {
    // android として読み込む
    const { resolvePlatformFetch } = await loadPlatformFor("android");
    // default のみ
    const defaultFetch = makeFetch("default");
    // resolve
    expect(resolvePlatformFetch({ default: defaultFetch })).toBe(defaultFetch);
  });

  // Platform.OS が switch に無い値（web 等）の場合は default を返す
  it("Platform.OS が switch に無い値のとき default を返す", async () => {
    // web として読み込む
    const { resolvePlatformFetch } = await loadPlatformFor("web");
    // default のみ
    const defaultFetch = makeFetch("default");
    // resolve
    expect(resolvePlatformFetch({ default: defaultFetch })).toBe(defaultFetch);
  });
});
