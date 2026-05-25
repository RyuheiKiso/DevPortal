// vitest DSL を取り込み
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// テスト対象
import { getNodeEnv, isDevelopment, isProduction } from "./env.js";

// NODE_ENV を退避するための変数（後段で復元する）
let originalNodeEnv: string | undefined;
// `__DEV__` を退避するための変数
let originalDev: unknown;
// `process` を退避するための変数
let originalProcess: unknown;

describe("env", () => {
  // 各テスト開始前に現在値を退避
  beforeEach(() => {
    // NODE_ENV を退避
    originalNodeEnv = process.env.NODE_ENV;
    // globalThis.__DEV__ を退避
    originalDev = (globalThis as { __DEV__?: unknown }).__DEV__;
    // globalThis.process を退避（後段でまるごと差し替えるテストに備える）
    originalProcess = (globalThis as { process?: unknown }).process;
  });

  // 各テスト終了後に元に戻す
  afterEach(() => {
    // process が差し替えられていたら復元する
    if ((globalThis as { process?: unknown }).process !== originalProcess) {
      Object.defineProperty(globalThis, "process", {
        value: originalProcess,
        configurable: true,
        writable: true,
      });
    }
    // NODE_ENV を退避値で復元
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    // __DEV__ を退避値で復元（undefined なら delete）
    if (originalDev === undefined) {
      delete (globalThis as { __DEV__?: unknown }).__DEV__;
    } else {
      Object.defineProperty(globalThis, "__DEV__", {
        value: originalDev,
        configurable: true,
        writable: true,
      });
    }
  });

  describe("getNodeEnv", () => {
    // NODE_ENV が設定されていればその値を返す
    it("returns process.env.NODE_ENV when defined", () => {
      // テスト用の値を設定
      process.env.NODE_ENV = "development";
      // 取得した値が等しい
      expect(getNodeEnv()).toBe("development");
    });

    // globalThis.process が undefined の場合は undefined を返す
    it("returns undefined when globalThis.process is missing", () => {
      // process をまるごと undefined に差し替える
      Object.defineProperty(globalThis, "process", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      // process が無い環境では undefined
      expect(getNodeEnv()).toBeUndefined();
    });

    // process.env の getter が throw する場合でも undefined を返す
    it("returns undefined when accessing process.env throws", () => {
      // throw する getter を持つ process を仕掛ける
      Object.defineProperty(globalThis, "process", {
        value: {
          get env(): never {
            throw new Error("env access blocked");
          },
        },
        configurable: true,
        writable: true,
      });
      // throw を握り潰して undefined を返す
      expect(getNodeEnv()).toBeUndefined();
    });
  });

  describe("isProduction", () => {
    // "production" のみが production と判定される
    it("returns true only for the exact string 'production'", () => {
      // production を設定
      process.env.NODE_ENV = "production";
      // true
      expect(isProduction()).toBe(true);
    });

    // 略記や別名は production とみなさない
    it.each(["prod", "PRODUCTION", "staging", "test", "development", ""])(
      "returns false for '%s'",
      (value) => {
        // テスト用の値を設定
        process.env.NODE_ENV = value;
        // 略記は false
        expect(isProduction()).toBe(false);
      },
    );

    // NODE_ENV 未定義のとき production ではない
    it("returns false when NODE_ENV is undefined", () => {
      // NODE_ENV を削除
      delete process.env.NODE_ENV;
      // false
      expect(isProduction()).toBe(false);
    });
  });

  describe("isDevelopment", () => {
    // NODE_ENV === "development" の strict 一致で true
    it("returns true when NODE_ENV is 'development'", () => {
      // development を設定
      process.env.NODE_ENV = "development";
      // true
      expect(isDevelopment()).toBe(true);
    });

    // __DEV__ === true で true（NODE_ENV が "test" 等のとき RN dev を救う）
    it("returns true when __DEV__ is true even if NODE_ENV is not 'development'", () => {
      // NODE_ENV を test にしておく（vitest の既定値）
      process.env.NODE_ENV = "test";
      // __DEV__ を true に
      Object.defineProperty(globalThis, "__DEV__", {
        value: true,
        configurable: true,
        writable: true,
      });
      // true
      expect(isDevelopment()).toBe(true);
    });

    // production が明示されていれば __DEV__ より優先
    it("returns false in production even if __DEV__ is true", () => {
      // production を設定
      process.env.NODE_ENV = "production";
      // __DEV__ も true に（production が勝つことを確認）
      Object.defineProperty(globalThis, "__DEV__", {
        value: true,
        configurable: true,
        writable: true,
      });
      // false（production 優先）
      expect(isDevelopment()).toBe(false);
    });

    // NODE_ENV 未定義かつ __DEV__ 未定義は dev とは判定しない（保守的）
    it("returns false when both NODE_ENV and __DEV__ are unset", () => {
      // NODE_ENV を削除
      delete process.env.NODE_ENV;
      // __DEV__ も削除
      delete (globalThis as { __DEV__?: unknown }).__DEV__;
      // false（warn 抑制側に倒す）
      expect(isDevelopment()).toBe(false);
    });

    // __DEV__ が boolean 以外（例えば真偽でない truthy）は dev と判定しない
    it.each([1, "yes", {}, null])(
      "returns false when __DEV__ is non-boolean truthy value (%j)",
      (value) => {
        // NODE_ENV は test
        process.env.NODE_ENV = "test";
        // __DEV__ に非 boolean を仕込む
        Object.defineProperty(globalThis, "__DEV__", {
          value,
          configurable: true,
          writable: true,
        });
        // strict 比較なので false
        expect(isDevelopment()).toBe(false);
      },
    );

    // NODE_ENV が "prod" や "staging" などのとき dev とはみなさない
    it.each(["prod", "staging", "test"])(
      "returns false for non-development NODE_ENV '%s'",
      (value) => {
        // テスト用の値を設定
        process.env.NODE_ENV = value;
        // __DEV__ も削除
        delete (globalThis as { __DEV__?: unknown }).__DEV__;
        // false
        expect(isDevelopment()).toBe(false);
      },
    );
  });
});
