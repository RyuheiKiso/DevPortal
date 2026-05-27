// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// React を取り込み
import * as React from "react";
// react-test-renderer から act / create を取り込み
import { act, create } from "react-test-renderer";
// core の型を取り込み（テストフィクスチャ用）
import type { BaseConfig, Theme } from "@k1s0-ts-config/core";

// hooks は Platform を直接参照しないが、context.ts → ConfigProvider 経由で参照される可能性に備えてモック
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

// テスト対象 hooks を取り込み
import { useConfig, useFeatureFlag, useTheme } from "./hooks.js";
// Provider を取り込み
import { ConfigProvider } from "./ConfigProvider.js";

// テスト用に最小の Theme を作る
function makeTheme(): Theme {
  // 必須キーのみ埋めた最小オブジェクト
  return {
    // 中立色
    colors: { primary: "#000", background: "#fff", text: "#111" },
    // 4 の倍数スケール
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    // 一般的なフォント設定
    typography: { fontFamily: "system-ui", baseSize: 14 },
  };
}

// テスト用に featureFlags 等を差し替えられる factory
function makeConfig(overrides: Partial<BaseConfig> = {}): BaseConfig {
  // 既定値に overrides をマージ
  return {
    // 開発環境
    env: "dev",
    // 既定はフラグなし
    featureFlags: {},
    // 既定テーマ
    theme: makeTheme(),
    // 個別上書き
    ...overrides,
  };
}

// hook の戻り値を観察するための Probe を作る
function makeProbe<T>(target: { current: T | undefined }, useHook: () => T) {
  // 戻り値を退避する関数コンポーネントを返す
  return function Probe(): React.JSX.Element {
    // hook を呼び戻り値を退避する
    target.current = useHook();
    // 描画は空
    return <>{null}</>;
  };
}

// useConfig
describe("useConfig (react-native)", () => {
  // Provider 配下では値を取得できること
  it("Provider 配下で渡された config を返す", async () => {
    // テスト用 config
    const config = makeConfig();
    // 戻り値の入れ物
    const ref: { current: BaseConfig | undefined } = { current: undefined };
    // Probe を作る
    const Probe = makeProbe(ref, () => useConfig());
    // Provider で囲んで描画
    await act(async () => {
      // Provider 内で hook 実行
      create(
        <ConfigProvider config={config}>
          <Probe />
        </ConfigProvider>,
      );
    });
    // Provider が渡した参照と同一であること
    expect(ref.current).toBe(config);
  });

  // Provider 外では Error を投げること
  it("Provider 外で呼ばれた場合は Error を投げる", async () => {
    // Probe 内部で発生した例外を補足する変数
    let captured: unknown;
    // Probe コンポーネント（Provider 外で hook を呼ぶ）
    function Probe(): React.JSX.Element {
      // React 19 + react-test-renderer では render 内 throw が同期的に伝搬しないため try/catch で補足する
      try {
        // Provider 外なので throw される想定
        useConfig();
      } catch (error) {
        // 例外を退避
        captured = error;
      }
      // 描画は空
      return <>{null}</>;
    }
    // Provider なしで描画（async act で render 完了を待機）
    await act(async () => {
      // create を実行（捕捉した例外は Probe 内に保存済み）
      create(<Probe />);
    });
    // Error インスタンスであること
    expect(captured).toBeInstanceOf(Error);
    // メッセージに ConfigProvider への誘導が含まれること
    expect((captured as Error).message).toMatch(/useConfig must be called inside <ConfigProvider>/);
  });
});

// useFeatureFlag
describe("useFeatureFlag (react-native)", () => {
  // 有効なフラグは true を返す
  it("有効なフラグは true を返す", async () => {
    // alpha フラグが true の config
    const config = makeConfig({ featureFlags: { alpha: true } });
    // 戻り値の入れ物
    const ref: { current: boolean | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref, () => useFeatureFlag("alpha"));
    // Provider で囲んで描画
    await act(async () => {
      // Provider 内で hook 実行
      create(
        <ConfigProvider config={config}>
          <Probe />
        </ConfigProvider>,
      );
    });
    // true が返ること
    expect(ref.current).toBe(true);
  });

  // 値が false のフラグは false を返す
  it("値が false のフラグは false を返す", async () => {
    // beta フラグが false の config
    const config = makeConfig({ featureFlags: { beta: false } });
    // 戻り値の入れ物
    const ref: { current: boolean | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref, () => useFeatureFlag("beta"));
    // Provider で囲んで描画
    await act(async () => {
      // Provider 内で hook 実行
      create(
        <ConfigProvider config={config}>
          <Probe />
        </ConfigProvider>,
      );
    });
    // false が返ること
    expect(ref.current).toBe(false);
  });

  // 未定義のフラグは false を返す（fallback 挙動）
  it("未定義のフラグは false を返す", async () => {
    // フラグなしの config
    const config = makeConfig();
    // 戻り値の入れ物
    const ref: { current: boolean | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref, () => useFeatureFlag("gamma"));
    // Provider で囲んで描画
    await act(async () => {
      // Provider 内で hook 実行
      create(
        <ConfigProvider config={config}>
          <Probe />
        </ConfigProvider>,
      );
    });
    // false が返ること（未定義キーは false 扱い）
    expect(ref.current).toBe(false);
  });
});

// useTheme
describe("useTheme (react-native)", () => {
  // Provider から渡されたテーマを返すこと
  it("Provider 配下で渡された theme を返す", async () => {
    // テーマを差し替えた config を用意
    const theme = makeTheme();
    // 識別用に primary を改変
    theme.colors.primary = "#ff0000";
    // config に組み込む
    const config = makeConfig({ theme });
    // 戻り値の入れ物
    const ref: { current: Theme | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref, () => useTheme());
    // Provider で囲んで描画
    await act(async () => {
      // Provider 内で hook 実行
      create(
        <ConfigProvider config={config}>
          <Probe />
        </ConfigProvider>,
      );
    });
    // Provider が渡したテーマと同一参照であること
    expect(ref.current).toBe(theme);
    // 識別用 primary が反映されていること
    expect(ref.current?.colors.primary).toBe("#ff0000");
  });
});
