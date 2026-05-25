// vitest DSL を取り込み
import { describe, expect, it } from "vitest";
// React を取り込み
import * as React from "react";
// react-test-renderer から act / create を取り込み
import { act, create } from "react-test-renderer";
// core の型を取り込み（テストフィクスチャのため）
import type { BaseConfig, Theme } from "@k1s0-ts-config/core";
// テスト対象を取り込み
import { ConfigProvider } from "./ConfigProvider.js";
// Context 値を観察するため Context 本体を取り込み
import { ConfigContext } from "./context.js";

// テスト用に最小の Theme を作る
function makeTheme(): Theme {
  // Theme 必須プロパティだけを揃えた最小オブジェクト
  return {
    // 中立色
    colors: { primary: "#000", background: "#fff", text: "#111" },
    // 4 の倍数スケール
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    // 一般的なフォント設定
    typography: { fontFamily: "system-ui", baseSize: 14 },
  };
}

// テスト用に最小の BaseConfig を作る
function makeConfig(): BaseConfig {
  // 必要最小限のフィールドだけ埋める
  return {
    // 開発環境固定
    env: "dev",
    // フラグなし
    featureFlags: {},
    // 最小テーマ
    theme: makeTheme(),
  };
}

// ConfigProvider のテストスイート
describe("ConfigProvider", () => {
  // Provider が config を Context に流すこと
  it("配下の Consumer に config を渡す", async () => {
    // テスト用に config を生成
    const config = makeConfig();
    // 受領した value を退避する箱
    let received: BaseConfig | null = null;
    // Context.Consumer で value を観察する子コンポーネント
    function Probe(): React.JSX.Element {
      // Consumer で value を受け取って退避する
      return (
        <ConfigContext.Consumer>
          {(value) => {
            // null 以外なら退避する
            received = value;
            // 描画は空
            return null;
          }}
        </ConfigContext.Consumer>
      );
    }
    // Provider で囲んで描画する
    await act(async () => {
      // ConfigProvider の render を実行
      create(
        <ConfigProvider config={config}>
          <Probe />
        </ConfigProvider>,
      );
    });
    // Provider が渡した参照と同一の config が観察できること
    expect(received).toBe(config);
  });

  // children をそのまま描画すること
  it("children をそのまま描画する", async () => {
    // 識別可能なテキストノード
    const marker = "marker-text";
    // 結果を格納する変数
    let tree: ReturnType<typeof create> | undefined;
    // Provider で囲んで描画する
    await act(async () => {
      // 最小 config を渡す
      tree = create(
        <ConfigProvider config={makeConfig()}>
          {/* React Text Node 自体は test renderer で文字列として読める */}
          <span>{marker}</span>
        </ConfigProvider>,
      );
    });
    // JSON ツリーから marker が出現すること
    expect(JSON.stringify(tree?.toJSON())).toContain(marker);
  });
});
