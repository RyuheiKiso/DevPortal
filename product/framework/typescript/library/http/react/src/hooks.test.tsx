// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// React を取り込み
import * as React from "react";
// react-test-renderer から act / create を取り込み
import { act, create } from "react-test-renderer";
// HttpClient 型と HttpClientConfig 型を取り込み
import type { HttpClient, HttpClientConfig, RetryPolicy, TimeoutPolicy } from "@k1s0-ts-http/core";
// テスト対象 hooks
import { useHttpClient, useScopedHttpClient } from "./hooks.js";
// Provider
import { HttpClientProvider } from "./HttpClientProvider.js";

// HttpClient モック factory（withConfig は呼ばれるたびに識別可能な新クライアントを返す）
function makeClient(id: string): HttpClient {
  // withConfig 呼び出し回数を id にエンコードして child の identity を作る
  let childCount = 0;
  // 最低限の HttpClient
  const client: HttpClient = {
    // request は呼ばれない想定
    request: vi.fn() as unknown as HttpClient["request"],
    // withConfig は新しい識別子付き client を返す
    withConfig: vi.fn(() => {
      // 子側 id
      childCount += 1;
      // 再帰的に生成
      return makeClient(`${id}>child${childCount}`);
    }) as unknown as HttpClient["withConfig"],
    // config 識別子
    config: { baseUrl: `https://${id}.example.com` },
  };
  // identity 用に id を残す
  (client as unknown as { __id: string }).__id = id;
  return client;
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

// useHttpClient
describe("useHttpClient", () => {
  // Provider 配下では値を取得できること
  it("Provider 配下で渡された client を返す", async () => {
    // テスト用 client
    const client = makeClient("root");
    // 戻り値の入れ物
    const ref: { current: HttpClient | undefined } = { current: undefined };
    // Probe
    const Probe = makeProbe(ref, () => useHttpClient());
    // Provider で囲んで描画
    await act(async () => {
      // Provider 内で hook 実行
      create(
        <HttpClientProvider client={client}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // Provider が渡した参照と同一であること
    expect(ref.current).toBe(client);
  });

  // Provider 外では Error を投げること
  it("Provider 外で呼ばれた場合は Error を投げる", () => {
    // 例外を補足する変数
    let captured: unknown;
    // Provider なしで hook を呼ぶ関数コンポーネント
    function Probe(): React.JSX.Element {
      // React 19 では render 内 throw が同期的に伝搬しないため try/catch で補足
      try {
        // Provider 外なので throw される想定
        useHttpClient();
      } catch (error) {
        // 例外を退避
        captured = error;
      }
      // 描画は空
      return <>{null}</>;
    }
    // 描画
    act(() => {
      // Provider なし
      create(<Probe />);
    });
    // Error インスタンスであること
    expect(captured).toBeInstanceOf(Error);
    // メッセージに HttpClientProvider への誘導が含まれること
    expect((captured as Error).message).toMatch(
      /useHttpClient must be called inside <HttpClientProvider>/,
    );
  });
});

// useScopedHttpClient
describe("useScopedHttpClient", () => {
  // 初回呼び出しで withConfig が呼ばれて派生クライアントが返ること
  it("初回呼び出しで withConfig が呼ばれる", async () => {
    // 親 client
    const parent = makeClient("p");
    // 戻り値の入れ物
    const ref: { current: HttpClient | undefined } = { current: undefined };
    // override
    const override = { baseUrl: "https://api.example.com" };
    // Probe
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 描画
    await act(async () => {
      // Provider 内で hook 実行
      create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // withConfig が呼ばれていること
    expect(parent.withConfig).toHaveBeenCalledWith(override);
    // 戻り値が親と異なること（child クライアント）
    expect(ref.current).not.toBe(parent);
  });

  // 同じ内容の override（参照は別でも）で再 render すると memoize されること
  it("同じ内容の override で再 render しても withConfig は呼ばれない", async () => {
    // 親 client
    const parent = makeClient("p");
    // 戻り値の入れ物
    const ref: { current: HttpClient | undefined } = { current: undefined };
    // Probe（毎回新オブジェクトだが内容同一）
    const Probe = makeProbe(ref, () =>
      useScopedHttpClient({ baseUrl: "https://api.example.com" }),
    );
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // withConfig は 1 回しか呼ばれない
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // baseUrl 変化で再生成
  it("baseUrl が変化したら withConfig が再度呼ばれる", async () => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: HttpClientConfig["baseUrl"] extends string | undefined
      ? { baseUrl: string }
      : never = { baseUrl: "https://a.example.com" };
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // baseUrl を変更
    override = { baseUrl: "https://b.example.com" };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // withConfig が 2 回呼ばれていること
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // defaultHeaders の片方 undefined / 配列の切替で再生成（shallowEqual: 片方 undefined 分岐）
  it("defaultHeaders が undefined⇔オブジェクトの切替で再生成", async () => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { defaultHeaders?: Record<string, string> } = {};
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // defaultHeaders を追加
    override = { defaultHeaders: { "X-A": "1" } };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成され withConfig は 2 回呼ばれる
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // defaultHeaders のキー数違いで再生成
  it("defaultHeaders のキー数が変わると再生成する", async () => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { defaultHeaders?: Record<string, string> } = {
      defaultHeaders: { "X-A": "1" },
    };
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // キーを増やす
    override = { defaultHeaders: { "X-A": "1", "X-B": "2" } };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // defaultHeaders のキー名違いで再生成（hasOwnProperty 分岐）
  it("defaultHeaders のキー名が変わると再生成する", async () => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { defaultHeaders?: Record<string, string> } = {
      defaultHeaders: { "X-A": "1" },
    };
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // キー名を変える
    override = { defaultHeaders: { "X-B": "1" } };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // defaultHeaders 値違いで再生成（Object.is 不一致分岐）
  it("defaultHeaders の同一キーで値が変わると再生成する", async () => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { defaultHeaders?: Record<string, string> } = {
      defaultHeaders: { "X-A": "1" },
    };
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 値を変える
    override = { defaultHeaders: { "X-A": "2" } };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // retry の任意フィールド変化で再生成
  it.each<[string, Partial<RetryPolicy>, Partial<RetryPolicy>]>([
    [
      "maxRetries",
      { maxRetries: 1, backoffBaseMs: 100, backoffMaxMs: 1000, jitter: "none", retryableStatuses: [500] },
      { maxRetries: 2, backoffBaseMs: 100, backoffMaxMs: 1000, jitter: "none", retryableStatuses: [500] },
    ],
    [
      "backoffBaseMs",
      { maxRetries: 1, backoffBaseMs: 100, backoffMaxMs: 1000, jitter: "none", retryableStatuses: [500] },
      { maxRetries: 1, backoffBaseMs: 200, backoffMaxMs: 1000, jitter: "none", retryableStatuses: [500] },
    ],
    [
      "backoffMaxMs",
      { maxRetries: 1, backoffBaseMs: 100, backoffMaxMs: 1000, jitter: "none", retryableStatuses: [500] },
      { maxRetries: 1, backoffBaseMs: 100, backoffMaxMs: 2000, jitter: "none", retryableStatuses: [500] },
    ],
    [
      "jitter",
      { maxRetries: 1, backoffBaseMs: 100, backoffMaxMs: 1000, jitter: "none", retryableStatuses: [500] },
      { maxRetries: 1, backoffBaseMs: 100, backoffMaxMs: 1000, jitter: "full", retryableStatuses: [500] },
    ],
    [
      "retryableStatuses",
      { maxRetries: 1, backoffBaseMs: 100, backoffMaxMs: 1000, jitter: "none", retryableStatuses: [500] },
      { maxRetries: 1, backoffBaseMs: 100, backoffMaxMs: 1000, jitter: "none", retryableStatuses: [503] },
    ],
  ])("retry.%s 変化で再生成する", async (_label, first, second) => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { retry?: Partial<RetryPolicy> } = { retry: first };
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () =>
      useScopedHttpClient(override as { retry?: RetryPolicy }),
    );
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // override を差し替え
    override = { retry: second };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // retry: 片方 undefined / オブジェクトの切替で再生成
  it("retry が undefined⇔オブジェクトの切替で再生成", async () => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { retry?: Partial<RetryPolicy> } = {};
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () =>
      useScopedHttpClient(override as { retry?: RetryPolicy }),
    );
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // retry を付与
    override = {
      retry: {
        maxRetries: 1,
        backoffBaseMs: 100,
        backoffMaxMs: 1000,
        jitter: "none",
        retryableStatuses: [500],
      },
    };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // retry の同内容（参照は別）は memoize される（retryEqual の全フィールド一致経路）
  it("retry の内容が同じなら参照が違っても memoize する", async () => {
    // 親 client
    const parent = makeClient("p");
    // Probe（毎回新 retry オブジェクトだが内容同一）
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () =>
      useScopedHttpClient({
        retry: {
          maxRetries: 1,
          backoffBaseMs: 100,
          backoffMaxMs: 1000,
          jitter: "none",
          retryableStatuses: [500],
        },
      }),
    );
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // withConfig は 1 回のみ
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // retryableStatuses の length 一致 / 要素差分（arrayEqual 内部分岐）
  it("retry.retryableStatuses の要素差分（同長）で再生成", async () => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { retry?: RetryPolicy } = {
      retry: {
        maxRetries: 1,
        backoffBaseMs: 100,
        backoffMaxMs: 1000,
        jitter: "none",
        retryableStatuses: [500, 502],
      } as RetryPolicy,
    };
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 要素片方を変える（長さは維持）
    override = {
      retry: {
        maxRetries: 1,
        backoffBaseMs: 100,
        backoffMaxMs: 1000,
        jitter: "none",
        retryableStatuses: [500, 503],
      } as RetryPolicy,
    };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // retryableStatuses の片方 undefined（arrayEqual の undefined 分岐）
  it("retry.retryableStatuses が undefined⇔配列の切替で再生成", async () => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { retry?: RetryPolicy } = {
      retry: {
        maxRetries: 1,
        backoffBaseMs: 100,
        backoffMaxMs: 1000,
        jitter: "none",
      } as RetryPolicy,
    };
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // retryableStatuses を付与
    override = {
      retry: {
        maxRetries: 1,
        backoffBaseMs: 100,
        backoffMaxMs: 1000,
        jitter: "none",
        retryableStatuses: [500],
      } as RetryPolicy,
    };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // timeout の totalMs / perAttemptMs 変化で再生成
  it.each<[string, TimeoutPolicy, TimeoutPolicy]>([
    ["totalMs", { totalMs: 5000, perAttemptMs: 1000 }, { totalMs: 6000, perAttemptMs: 1000 }],
    ["perAttemptMs", { totalMs: 5000, perAttemptMs: 1000 }, { totalMs: 5000, perAttemptMs: 2000 }],
  ])("timeout.%s 変化で再生成する", async (_label, first, second) => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { timeout?: TimeoutPolicy } = { timeout: first };
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // override を差し替え
    override = { timeout: second };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // timeout の片方 undefined / オブジェクトの切替で再生成
  it("timeout が undefined⇔オブジェクトの切替で再生成", async () => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { timeout?: TimeoutPolicy } = {};
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // timeout を付与
    override = { timeout: { totalMs: 5000, perAttemptMs: 1000 } };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // timeout の内容が同じなら memoize（timeoutEqual の全フィールド一致経路）
  it("timeout の内容が同じなら参照が違っても memoize する", async () => {
    // 親 client
    const parent = makeClient("p");
    // Probe（毎回新 timeout オブジェクトだが内容同一）
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () =>
      useScopedHttpClient({ timeout: { totalMs: 5000, perAttemptMs: 1000 } }),
    );
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // withConfig は 1 回のみ
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // 親 client の差し替えで再生成
  it("親 client が変化したら再生成する", async () => {
    // A / B の親
    const parentA = makeClient("A");
    const parentB = makeClient("B");
    // Probe（固定 override）
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () =>
      useScopedHttpClient({ baseUrl: "https://x.example.com" }),
    );
    // 初回 A
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parentA}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 親を B に差し替え
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parentB}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // A.withConfig と B.withConfig がそれぞれ 1 回ずつ
    expect((parentA.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((parentB.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // retry の retryableStatuses が両方 undefined のケース（arrayEqual の a===b → true 経路）
  it("retry.retryableStatuses が両方 undefined でも memoize する", async () => {
    // 親 client
    const parent = makeClient("p");
    // Probe（毎回新規 retry オブジェクトだが retryableStatuses は未指定）
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () =>
      useScopedHttpClient({
        retry: {
          maxRetries: 1,
          backoffBaseMs: 100,
          backoffMaxMs: 1000,
          jitter: "none",
        } as RetryPolicy,
      }),
    );
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // withConfig は 1 回のみ
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // retry.retryableStatuses の長さ差分（arrayEqual の length !== length 分岐）
  it("retry.retryableStatuses の長さが違うと再生成する", async () => {
    // 親 client
    const parent = makeClient("p");
    // 切替可能 override
    let override: { retry?: RetryPolicy } = {
      retry: {
        maxRetries: 1,
        backoffBaseMs: 100,
        backoffMaxMs: 1000,
        jitter: "none",
        retryableStatuses: [500],
      } as RetryPolicy,
    };
    // Probe
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () => useScopedHttpClient(override));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 長さを 2 に増やす
    override = {
      retry: {
        maxRetries: 1,
        backoffBaseMs: 100,
        backoffMaxMs: 1000,
        jitter: "none",
        retryableStatuses: [500, 502],
      } as RetryPolicy,
    };
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再生成
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  // defaultHeaders の全フィールドが一致するときは memoize（shallowEqual の loop 通過 + return true 経路）
  it("defaultHeaders の複数キーが完全一致なら参照が違っても memoize する", async () => {
    // 親 client
    const parent = makeClient("p");
    // Probe（毎回新規オブジェクトだが内容同一）
    const ref: { current: HttpClient | undefined } = { current: undefined };
    const Probe = makeProbe(ref, () =>
      useScopedHttpClient({ defaultHeaders: { "X-A": "1", "X-B": "2", "X-C": "3" } }),
    );
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // withConfig は 1 回のみ
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  // 全フィールドが undefined のときも一致と判定し memoize する（各 *Equal の a===b → true 経路）
  it("override が空オブジェクトでも再 render で memoize する", async () => {
    // 親 client
    const parent = makeClient("p");
    // 戻り値の入れ物
    const ref: { current: HttpClient | undefined } = { current: undefined };
    // 毎回新規 {} を渡す
    const Probe = makeProbe(ref, () => useScopedHttpClient({}));
    // 初回描画
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      // 描画
      renderer = create(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // 再描画
    await act(async () => {
      // update
      renderer?.update(
        <HttpClientProvider client={parent}>
          <Probe />
        </HttpClientProvider>,
      );
    });
    // withConfig は 1 回のみ
    expect((parent.withConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
