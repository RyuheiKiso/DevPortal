// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";

// platform.ts が import する react-native を最小モック（rollup が index.js.flow を解析できないため）
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

// React を取り込み
import * as React from "react";
// react-test-renderer から act / create を取り込み
import { act, create } from "react-test-renderer";
// HttpClient 型を取り込み
import type { HttpClient } from "@k1s0-ts-http/core";
// テスト対象を取り込み
import { HttpClientProvider } from "./HttpClientProvider.js";
// Context 本体を取り込み（Consumer で観測するため）
import { HttpClientContext } from "./context.js";

// HttpClient モック factory
function makeClient(): HttpClient {
  // 最低限の HttpClient
  return {
    // request は呼ばれない想定
    request: vi.fn() as unknown as HttpClient["request"],
    // withConfig も呼ばれない想定
    withConfig: vi.fn(),
    // config は空オブジェクト
    config: {},
  };
}

// HttpClientProvider のテストスイート
describe("HttpClientProvider", () => {
  // Provider が client を Context に流すこと
  it("配下の Consumer に client を渡す", async () => {
    // テスト用 client を用意
    const client = makeClient();
    // 受領した value を退避する箱
    let received: HttpClient | null = null;
    // Context.Consumer で value を観察する子コンポーネント
    function Probe(): React.JSX.Element {
      // Consumer で value を受け取って退避する
      return (
        <HttpClientContext.Consumer>
          {(value) => {
            // null 以外なら退避する
            received = value;
            // 描画は空
            return null;
          }}
        </HttpClientContext.Consumer>
      );
    }
    // Provider で囲んで描画する
    await act(async () => {
      // HttpClientProvider の render を実行
      create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // Provider が渡した参照と同一の client が観察できること
    expect(received).toBe(client);
  });

  // children をそのまま描画すること
  it("children をそのまま描画する", async () => {
    // 識別可能なテキスト
    const marker = "http-marker";
    // 結果を格納する変数
    let tree: ReturnType<typeof create> | undefined;
    // Provider で囲んで描画する
    await act(async () => {
      // HttpClientProvider 経由で marker をぶら下げる
      tree = create(
        <HttpClientProvider client={makeClient()}>
          <span>{marker}</span>
        </HttpClientProvider>,
      );
    });
    // JSON ツリーから marker が出現すること
    expect(JSON.stringify(tree?.toJSON())).toContain(marker);
  });
});
