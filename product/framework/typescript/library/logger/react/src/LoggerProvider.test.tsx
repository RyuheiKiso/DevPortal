// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// React を取り込み
import * as React from "react";
// react-test-renderer から act / create を取り込み
import { act, create } from "react-test-renderer";
// core から Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";
// テスト対象を取り込み
import { LoggerProvider } from "./LoggerProvider.js";
// Context 本体を取り込み（Consumer で観測するため）
import { LoggerContext } from "./context.js";

// テスト用に最小限の Logger モックを生成する
function makeLogger(): Logger {
  // 全メソッドを vi.fn() のスタブで埋める
  return {
    // 各レベル
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    // child は自分自身を返す簡略実装
    child: vi.fn().mockReturnThis(),
    // flush / dispose は no-op で OK
    flush: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

// LoggerProvider のテストスイート
describe("LoggerProvider", () => {
  // Provider が logger を Context に流すこと
  it("配下の Consumer に logger を渡す", async () => {
    // テスト用 logger を用意
    const logger = makeLogger();
    // 受領した value を退避する箱
    let received: Logger | null = null;
    // Context.Consumer で value を観察する子コンポーネント
    function Probe(): React.JSX.Element {
      // Consumer で value を受け取って退避する
      return (
        <LoggerContext.Consumer>
          {(value) => {
            // null 以外なら退避する
            received = value;
            // 描画は空
            return null;
          }}
        </LoggerContext.Consumer>
      );
    }
    // Provider で囲んで描画する
    await act(async () => {
      // LoggerProvider の render を実行
      create(
        <LoggerProvider logger={logger}>
          <Probe />
        </LoggerProvider>,
      );
    });
    // Provider が渡した参照と同一の logger が観察できること
    expect(received).toBe(logger);
  });

  // children をそのまま描画すること
  it("children をそのまま描画する", async () => {
    // 識別可能なテキスト
    const marker = "logger-marker";
    // 結果を格納する変数
    let tree: ReturnType<typeof create> | undefined;
    // Provider で囲んで描画する
    await act(async () => {
      // LoggerProvider 経由で marker をぶら下げる
      tree = create(
        <LoggerProvider logger={makeLogger()}>
          <span>{marker}</span>
        </LoggerProvider>,
      );
    });
    // JSON ツリーから marker が出現すること
    expect(JSON.stringify(tree?.toJSON())).toContain(marker);
  });
});
