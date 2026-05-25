// vitest DSL を取り込み
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// テスト対象を取り込み
import { createWebTokenStore } from "./storage.js";
// 公開型を取り込み
import type { WebKeyValueStorage } from "./storage.js";

// テスト用のメモリ Storage 実装を作るヘルパ
function createFakeStorage(): WebKeyValueStorage & { backing: Map<string, string> } {
  // バッキング Map を用意する
  const backing = new Map<string, string>();
  // 最小 API を実装して返す
  return {
    // バッキングを参照可能にしておく（テストでのアサーション用）
    backing,
    // get
    getItem(key: string): string | null {
      // Map の値を取り出す（無ければ null を返して仕様に合わせる）
      const value = backing.get(key);
      // undefined を null に変換する
      return value === undefined ? null : value;
    },
    // set
    setItem(key: string, value: string): void {
      // Map に保存する
      backing.set(key, value);
    },
    // delete
    removeItem(key: string): void {
      // Map から削除する
      backing.delete(key);
    },
  };
}

// createWebTokenStore のテスト
describe("createWebTokenStore", () => {
  // window.localStorage を退避する変数
  let savedDescriptor: PropertyDescriptor | undefined;
  // 各テスト前に window が存在することを保証
  beforeEach(() => {
    // 元の localStorage descriptor を退避する
    savedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  });
  // 各テスト後にグローバルを復元する
  afterEach(() => {
    // 退避した descriptor を戻す
    if (savedDescriptor === undefined) {
      // 元から無ければ削除する
      delete (globalThis as { window?: unknown }).window;
    } else {
      // 元 descriptor を戻す
      Object.defineProperty(globalThis, "window", savedDescriptor);
    }
  });

  // 明示渡しの storage に書き込めること
  it("明示指定された storage に対して get / set / clear ができる", async () => {
    // fake storage を用意する
    const storage = createFakeStorage();
    // カスタムキーを使う
    const store = createWebTokenStore({ storage, key: "custom:key" });
    // 初期状態では undefined
    expect(await store.get()).toBeUndefined();
    // set すると JSON 形式で保存される
    await store.set({ accessToken: "abc", refreshToken: "r" });
    // バッキングに書かれていること
    expect(storage.backing.get("custom:key")).toBe(JSON.stringify({ accessToken: "abc", refreshToken: "r" }));
    // get で復元できること
    expect(await store.get()).toEqual({ accessToken: "abc", refreshToken: "r" });
    // clear で削除される
    await store.clear();
    // バッキングから消えていること
    expect(storage.backing.has("custom:key")).toBe(false);
  });

  // 既定キーを使えること
  it("key を省略すると既定キー k1s0.auth.tokens を使う", async () => {
    // fake storage
    const storage = createFakeStorage();
    // key を省略
    const store = createWebTokenStore({ storage });
    // 値を保存する
    await store.set({ accessToken: "x" });
    // 既定キーで保存されていること
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(true);
  });

  // JSON 破損時はクリーンアップして undefined を返すこと
  it("get で JSON.parse できなければ破損データを掃除して undefined を返す", async () => {
    // fake storage に壊れた JSON を仕込む
    const storage = createFakeStorage();
    // 直接 backing に壊れた値を入れる
    storage.backing.set("k1s0.auth.tokens", "{not-json");
    // store を作る
    const store = createWebTokenStore({ storage });
    // get は undefined を返すこと
    expect(await store.get()).toBeUndefined();
    // 破損データは削除されていること
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // JSON.parse は成功するが null だった場合も破損扱いになること
  it("JSON 値が null の場合も破損扱いとして undefined を返す", async () => {
    // null 文字列を仕込む
    const storage = createFakeStorage();
    // 直接 null を保存
    storage.backing.set("k1s0.auth.tokens", "null");
    // store を作る
    const store = createWebTokenStore({ storage });
    // undefined を返すこと
    expect(await store.get()).toBeUndefined();
    // 掃除されていること
    expect(storage.backing.has("k1s0.auth.tokens")).toBe(false);
  });

  // JSON.parse は成功するが非オブジェクト（文字列）の場合も破損扱いになること
  it("JSON 値がオブジェクト以外の場合も破損扱いとして undefined を返す", async () => {
    // 文字列リテラルを仕込む
    const storage = createFakeStorage();
    // 直接文字列を保存
    storage.backing.set("k1s0.auth.tokens", '"just-a-string"');
    // store を作る
    const store = createWebTokenStore({ storage });
    // undefined を返すこと
    expect(await store.get()).toBeUndefined();
  });

  // window が無い場合（SSR シミュ）でも throw せずメモリ動作にフォールバックすること
  it("window 未定義（SSR）ではメモリ実装にフォールバックする", async () => {
    // window を削除する
    delete (globalThis as { window?: unknown }).window;
    // オプション無しで作る（既定で window.localStorage を見にいく）
    const store = createWebTokenStore();
    // 初期は undefined
    expect(await store.get()).toBeUndefined();
    // 保存できる
    await store.set({ accessToken: "fallback" });
    // 同じインスタンス内では取得できる
    expect(await store.get()).toEqual({ accessToken: "fallback" });
  });

  // window.localStorage 参照時に throw する環境でもメモリにフォールバックすること
  it("localStorage 参照が throw する環境でもメモリにフォールバックする", async () => {
    // window.localStorage が throw する getter を仕込む
    const fakeWindow: Record<string, unknown> = {};
    // localStorage の getter で例外を投げさせる
    Object.defineProperty(fakeWindow, "localStorage", {
      // getter で常に throw
      get() {
        // 例外を投げる
        throw new Error("denied");
      },
      // 内部だけで使うので enumerable
      configurable: true,
    });
    // global window を差し替える
    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    // オプション無しで作る
    const store = createWebTokenStore();
    // 初期は undefined
    expect(await store.get()).toBeUndefined();
    // 保存しても throw しないこと
    await store.set({ accessToken: "safe" });
    // 取得できること
    expect(await store.get()).toEqual({ accessToken: "safe" });
  });

  // window.localStorage が undefined の場合でもフォールバックすること
  it("window.localStorage が null の場合もメモリにフォールバックする", async () => {
    // 明示的に localStorage=null を持つ window を作る
    Object.defineProperty(globalThis, "window", {
      // null を返す Storage
      value: { localStorage: null },
      // 後で復元できるようにする
      configurable: true,
    });
    // store を作る
    const store = createWebTokenStore();
    // メモリ動作になっていること（throw せず undefined を返す）
    expect(await store.get()).toBeUndefined();
  });

  // 既定の window.localStorage を利用できること
  it("window.localStorage を既定値として利用する", async () => {
    // backing storage を fake で作る
    const fakeStorage = createFakeStorage();
    // fake window を差し込む
    Object.defineProperty(globalThis, "window", {
      // localStorage プロパティに fake を載せる
      value: { localStorage: fakeStorage },
      // 復元可能にする
      configurable: true,
    });
    // store を作る（storage を渡さない）
    const store = createWebTokenStore();
    // 値を保存する
    await store.set({ accessToken: "from-default" });
    // 既定キーで fake storage に書かれていること
    expect(fakeStorage.backing.get("k1s0.auth.tokens")).toBe(JSON.stringify({ accessToken: "from-default" }));
  });

  // setItem / removeItem が呼ばれていることを確認するスパイ
  it("set と clear で storage の setItem / removeItem を呼ぶ", async () => {
    // 元 storage
    const storage = createFakeStorage();
    // setItem を spy する
    const setSpy = vi.spyOn(storage, "setItem");
    // removeItem を spy する
    const removeSpy = vi.spyOn(storage, "removeItem");
    // store を作る
    const store = createWebTokenStore({ storage });
    // set する
    await store.set({ accessToken: "a" });
    // setItem が呼ばれていること
    expect(setSpy).toHaveBeenCalledTimes(1);
    // clear する
    await store.clear();
    // removeItem が呼ばれていること
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
