// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// React test renderer を取り込み
import { act, create } from "react-test-renderer";
// AppError 型を取り込み
import type { AppError } from "@k1s0-ts-error/core";
// Provider と hook 群を取り込み
import { ErrorProvider } from "./ErrorProvider.js";
import { useAsyncErrorHandler, useErrorContext, useLastError } from "./hooks.js";

// 失敗する async 関数を hook で包んで実行結果を取り出す probe
function AsyncProbe(props: { onReady: (run: () => Promise<string | undefined>) => void }): null {
  const run = useAsyncErrorHandler(async () => {
    // network エラー風の例外を意図的に throw
    throw Object.assign(new Error("Network down"), { code: "NETWORK_ERROR" });
  });
  props.onReady(run);
  return null;
}

// Provider 外で useErrorContext を呼ぶと throw されることを検証する probe
function OutsideProbe(): null {
  useErrorContext();
  return null;
}

// useLastError の値を受け取る probe
function LastErrorProbe(props: { onValue: (value: AppError | null) => void }): null {
  props.onValue(useLastError());
  return null;
}

// hook 群の挙動を検証する
describe("react error hooks", () => {
  // useAsyncErrorHandler は async 失敗を handleError に橋渡しする
  it("forwards async failures to handleError", async () => {
    // 実行関数を受け取る変数
    let run: (() => Promise<string | undefined>) | undefined;
    let lastError: AppError | null = null;

    // Provider 配下で probe を描画
    act(() => {
      create(
        <ErrorProvider>
          <AsyncProbe onReady={(next) => (run = next)} />
          <LastErrorProbe onValue={(value) => (lastError = value)} />
        </ErrorProvider>,
      );
    });

    // 失敗 promise を await
    await act(async () => {
      await run?.();
    });

    // network エラーとして lastError に積まれる
    expect(lastError?.kind).toBe("network");
  });

  // Provider 外で hook を呼ぶと明示的に throw される
  it("throws when used outside ErrorProvider", () => {
    expect(() => {
      act(() => {
        create(<OutsideProbe />);
      });
    }).toThrow("useErrorHandler must be called inside <ErrorProvider>");
  });
});
