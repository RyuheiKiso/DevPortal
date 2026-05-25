// vitest のテスト API を取り込み
import { describe, expect, it } from "vitest";
// React test renderer を取り込み
import { act, create } from "react-test-renderer";
// AppError 型を取り込み
import type { AppError } from "@k1s0-ts-error/core";
// Provider と hook 群を取り込み
import { ErrorProvider } from "./ErrorProvider.js";
import { useAsyncErrorHandler, useErrorContext, useLastError } from "./hooks.js";

// 失敗 async を hook で包み実行関数を取り出す probe
function AsyncProbe(props: { onReady: (run: () => Promise<string | undefined>) => void }): null {
  const run = useAsyncErrorHandler(async () => {
    throw Object.assign(new Error("Network down"), { code: "NETWORK_ERROR" });
  });
  props.onReady(run);
  return null;
}

// Provider 外で hook を呼ぶ probe
function OutsideProbe(): null {
  useErrorContext();
  return null;
}

// useLastError の値を取り出す probe
function LastErrorProbe(props: { onValue: (value: AppError | null) => void }): null {
  props.onValue(useLastError());
  return null;
}

// hook 群の挙動を検証する
describe("react-native error hooks", () => {
  // useAsyncErrorHandler は async 失敗を handleError に橋渡しする
  it("forwards async failures to handleError", async () => {
    let run: (() => Promise<string | undefined>) | undefined;
    let lastError: AppError | null = null;

    act(() => {
      create(
        <ErrorProvider>
          <AsyncProbe onReady={(next) => (run = next)} />
          <LastErrorProbe onValue={(value) => (lastError = value)} />
        </ErrorProvider>,
      );
    });

    await act(async () => {
      await run?.();
    });

    expect(lastError?.kind).toBe("network");
  });

  // Provider 外で hook を呼ぶと throw
  it("throws when used outside ErrorProvider", () => {
    expect(() => {
      act(() => {
        create(<OutsideProbe />);
      });
    }).toThrow("useErrorHandler must be called inside <ErrorProvider>");
  });
});
