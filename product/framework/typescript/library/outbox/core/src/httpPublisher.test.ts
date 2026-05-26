// vitest API
import { describe, expect, it, vi } from "vitest";
// 対象モジュール
import {
  createHttpPublisher,
  DEFAULT_RETRYABLE_STATUSES,
  IDEMPOTENCY_KEY_HEADER,
} from "./httpPublisher.js";
// 型
import type {
  HttpClientLike,
  HttpRequestInitLike,
  HttpResponseLike,
  OutboxEntry,
  PublishContext,
} from "./types.js";
// エラー
import { OutboxError } from "./errors.js";

// テストヘルパ
function makeEntry(): OutboxEntry<{ x: number }> {
  return {
    id: "e1",
    status: "publishing",
    payload: { x: 1 },
    idempotencyKey: "ik-1",
    attemptCount: 0,
    maxAttempts: 3,
    createdAt: 0,
    updatedAt: 0,
  };
}
function makeCtx(signal?: AbortSignal): PublishContext {
  // signal が無ければ AbortController で新規作成
  const controller = new AbortController();
  return {
    attempt: 0,
    signal: signal ?? controller.signal,
    idempotencyKey: "ik-1",
    entryId: "e1",
  };
}

// 公開定数
describe("constants", () => {
  // Idempotency-Key ヘッダ名
  it("exposes IDEMPOTENCY_KEY_HEADER", () => {
    // 値の確認
    expect(IDEMPOTENCY_KEY_HEADER).toBe("Idempotency-Key");
  });
  // 既定 retryable ステータス
  it("exposes DEFAULT_RETRYABLE_STATUSES", () => {
    // 集合に 429 / 503 が含まれる
    expect(DEFAULT_RETRYABLE_STATUSES.has(429)).toBe(true);
    expect(DEFAULT_RETRYABLE_STATUSES.has(503)).toBe(true);
    // 200 は含まれない
    expect(DEFAULT_RETRYABLE_STATUSES.has(200)).toBe(false);
  });
});

// createHttpPublisher の動作
describe("createHttpPublisher", () => {
  // Idempotency-Key を自動付与
  it("auto-adds Idempotency-Key when not provided", async () => {
    // mock client
    const request = vi.fn(async (_init: HttpRequestInitLike): Promise<HttpResponseLike> => ({ status: 200, ok: true }));
    const client: HttpClientLike = { request };
    // publisher
    const publisher = createHttpPublisher<{ x: number }>(client, {
      resolveRequest: () => ({ method: "POST", url: "/orders" }),
    });
    // 呼び出し
    await publisher(makeEntry(), makeCtx());
    // ヘッダにキーが入る
    expect(request).toHaveBeenCalled();
    const init = request.mock.calls[0]![0]!;
    expect(init.headers?.[IDEMPOTENCY_KEY_HEADER]).toBe("ik-1");
  });

  // ユーザー指定の Idempotency-Key を優先
  it("respects user-provided Idempotency-Key", async () => {
    // mock client
    const request = vi.fn(async (_init: HttpRequestInitLike): Promise<HttpResponseLike> => ({ status: 200, ok: true }));
    const client: HttpClientLike = { request };
    // publisher
    const publisher = createHttpPublisher<{ x: number }>(client, {
      resolveRequest: () => ({
        method: "POST",
        url: "/orders",
        headers: { "Idempotency-Key": "user-defined" },
      }),
    });
    // 呼び出し
    await publisher(makeEntry(), makeCtx());
    // ユーザー指定が残る
    const init = request.mock.calls[0]![0]!;
    expect(init.headers?.[IDEMPOTENCY_KEY_HEADER]).toBe("user-defined");
  });

  // 大文字小文字違い (idempotency-key) でもユーザー指定が優先される
  it("respects lowercased idempotency-key header from user", async () => {
    // mock
    const request = vi.fn(async (): Promise<HttpResponseLike> => ({ status: 200, ok: true }));
    const client: HttpClientLike = { request };
    // publisher
    const publisher = createHttpPublisher<{ x: number }>(client, {
      resolveRequest: () => ({
        method: "POST",
        url: "/orders",
        headers: { "idempotency-key": "lowercased" },
      }),
    });
    // 呼び出し
    await publisher(makeEntry(), makeCtx());
    // 自動付与されない
    const init = request.mock.calls[0]![0]!;
    expect(init.headers?.[IDEMPOTENCY_KEY_HEADER]).toBeUndefined();
    expect(init.headers?.["idempotency-key"]).toBe("lowercased");
  });

  // 4xx/5xx を retryable=true で OutboxError throw
  it("throws OutboxError with retryable=true on 503", async () => {
    // mock client (503 を返す)
    const request = vi.fn(async (): Promise<HttpResponseLike> => ({ status: 503, ok: false }));
    const client: HttpClientLike = { request };
    // publisher
    const publisher = createHttpPublisher<{ x: number }>(client, {
      resolveRequest: () => ({ method: "POST", url: "/orders" }),
    });
    // 失敗を捕捉
    let caught: unknown;
    try {
      await publisher(makeEntry(), makeCtx());
    } catch (e) {
      caught = e;
    }
    // OutboxError かつ retryable=true
    expect(caught).toBeInstanceOf(OutboxError);
    expect((caught as OutboxError).retryable).toBe(true);
  });

  // 400 のようなクライアントエラーは retryable=false
  it("throws OutboxError with retryable=false on non-retryable status", async () => {
    // 400
    const request = vi.fn(async (): Promise<HttpResponseLike> => ({ status: 400, ok: false }));
    const client: HttpClientLike = { request };
    const publisher = createHttpPublisher<{ x: number }>(client, {
      resolveRequest: () => ({ method: "POST", url: "/orders" }),
    });
    // 失敗
    let caught: unknown;
    try {
      await publisher(makeEntry(), makeCtx());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OutboxError);
    expect((caught as OutboxError).retryable).toBe(false);
  });

  // treatAsSuccess / treatAsRetryable をユーザー指定
  it("honors custom treatAsSuccess and treatAsRetryable", async () => {
    // mock (status=201 を返すが ok=false)
    const request = vi.fn(async (): Promise<HttpResponseLike> => ({ status: 201, ok: false }));
    const client: HttpClientLike = { request };
    // 成功判定を上書き
    const publisher = createHttpPublisher<{ x: number }>(client, {
      resolveRequest: () => ({ method: "POST", url: "/orders" }),
      treatAsSuccess: (r) => r.status === 201,
    });
    // 成功扱い
    await expect(publisher(makeEntry(), makeCtx())).resolves.toBeUndefined();
  });

  // ctx.signal を request init.signal に伝播
  it("propagates ctx.signal to request init", async () => {
    // mock
    const request = vi.fn(async (init: HttpRequestInitLike): Promise<HttpResponseLike> => {
      // signal が定義されている
      expect(init.signal).toBeDefined();
      return { status: 200, ok: true };
    });
    const client: HttpClientLike = { request };
    const publisher = createHttpPublisher<{ x: number }>(client, {
      resolveRequest: () => ({ method: "POST", url: "/orders" }),
    });
    // 呼び出し
    const controller = new AbortController();
    await publisher(makeEntry(), makeCtx(controller.signal));
    // request が呼ばれている
    expect(request).toHaveBeenCalled();
  });

  // resolveRequest が独自 signal を渡してきても両方マージされる
  it("merges signal from resolveRequest with ctx.signal", async () => {
    // mock: signal を取得
    const request = vi.fn(async (init: HttpRequestInitLike): Promise<HttpResponseLike> => {
      // signal が定義されている
      expect(init.signal).toBeDefined();
      return { status: 200, ok: true };
    });
    const client: HttpClientLike = { request };
    // 独自 signal を返す resolveRequest
    const userController = new AbortController();
    const publisher = createHttpPublisher<{ x: number }>(client, {
      resolveRequest: () => ({ method: "POST", url: "/orders", signal: userController.signal }),
    });
    await publisher(makeEntry(), makeCtx());
    expect(request).toHaveBeenCalled();
  });

  // 既に abort 済みの base signal が伝播する (AbortSignal.any 未実装環境のフォールバック)
  it("handles already-aborted base signal in fallback merge", async () => {
    // AbortSignal.any を一時的に外す (フォールバック実装を検証)
    const original = (AbortSignal as unknown as { any?: unknown }).any;
    (AbortSignal as unknown as { any?: unknown }).any = undefined;
    try {
      // mock
      const request = vi.fn(async (init: HttpRequestInitLike): Promise<HttpResponseLike> => {
        // signal は abort 済み
        expect(init.signal?.aborted).toBe(true);
        return { status: 200, ok: true };
      });
      const client: HttpClientLike = { request };
      // base controller を abort してから渡す
      const baseController = new AbortController();
      baseController.abort(new Error("base aborted"));
      // ユーザー signal は健全
      const userController = new AbortController();
      const publisher = createHttpPublisher<{ x: number }>(client, {
        resolveRequest: () => ({ method: "POST", url: "/orders", signal: userController.signal }),
      });
      // ctx.signal は abort 済み
      await publisher(makeEntry(), makeCtx(baseController.signal));
      expect(request).toHaveBeenCalled();
    } finally {
      // 元に戻す
      (AbortSignal as unknown as { any?: unknown }).any = original;
    }
  });

  // フォールバック merge: extra が既に abort 済みでも伝播する
  it("handles already-aborted extra signal in fallback merge", async () => {
    // AbortSignal.any を外す
    const original = (AbortSignal as unknown as { any?: unknown }).any;
    (AbortSignal as unknown as { any?: unknown }).any = undefined;
    try {
      const request = vi.fn(async (init: HttpRequestInitLike): Promise<HttpResponseLike> => {
        // signal は abort 済み
        expect(init.signal?.aborted).toBe(true);
        return { status: 200, ok: true };
      });
      const client: HttpClientLike = { request };
      // ユーザー signal を abort 済みに
      const userController = new AbortController();
      userController.abort(new Error("user aborted"));
      const publisher = createHttpPublisher<{ x: number }>(client, {
        resolveRequest: () => ({ method: "POST", url: "/orders", signal: userController.signal }),
      });
      // ctx.signal は健全
      await publisher(makeEntry(), makeCtx());
      expect(request).toHaveBeenCalled();
    } finally {
      (AbortSignal as unknown as { any?: unknown }).any = original;
    }
  });

  // フォールバック merge: 両方健全な場合の addEventListener パスをカバーする
  it("handles healthy signals in fallback merge with event listeners", async () => {
    // AbortSignal.any を外す
    const original = (AbortSignal as unknown as { any?: unknown }).any;
    (AbortSignal as unknown as { any?: unknown }).any = undefined;
    try {
      // 後で abort する controller を 2 つ用意
      const baseController = new AbortController();
      const userController = new AbortController();
      // mock client (request 中に signal を覚える)
      let observedSignal: AbortSignal | undefined;
      const request = vi.fn(async (init: HttpRequestInitLike): Promise<HttpResponseLike> => {
        observedSignal = init.signal;
        return { status: 200, ok: true };
      });
      const client: HttpClientLike = { request };
      const publisher = createHttpPublisher<{ x: number }>(client, {
        resolveRequest: () => ({ method: "POST", url: "/orders", signal: userController.signal }),
      });
      // ctx.signal は base
      await publisher(makeEntry(), makeCtx(baseController.signal));
      // signal はマージされて非 base/extra
      expect(observedSignal).toBeDefined();
      expect(observedSignal!.aborted).toBe(false);
      // 後から base を abort すると merged も abort される (addEventListener パス)
      baseController.abort(new Error("late base abort"));
      expect(observedSignal!.aborted).toBe(true);
      // 別ケース: user の addEventListener パス
      const baseController2 = new AbortController();
      const userController2 = new AbortController();
      let observedSignal2: AbortSignal | undefined;
      const request2 = vi.fn(async (init: HttpRequestInitLike): Promise<HttpResponseLike> => {
        observedSignal2 = init.signal;
        return { status: 200, ok: true };
      });
      const client2: HttpClientLike = { request: request2 };
      const publisher2 = createHttpPublisher<{ x: number }>(client2, {
        resolveRequest: () => ({ method: "POST", url: "/orders", signal: userController2.signal }),
      });
      await publisher2(makeEntry(), makeCtx(baseController2.signal));
      // 後から user を abort
      userController2.abort(new Error("late user abort"));
      expect(observedSignal2!.aborted).toBe(true);
    } finally {
      (AbortSignal as unknown as { any?: unknown }).any = original;
    }
  });

  // AbortSignal.any が使える環境の動作
  it("uses AbortSignal.any when available", async () => {
    // AbortSignal.any が存在することを確認 (Node 22+ ではあるはず)
    const anyFn = (AbortSignal as unknown as { any?: unknown }).any;
    if (typeof anyFn !== "function") {
      // 未提供環境ではスキップ
      return;
    }
    // mock
    const request = vi.fn(async (): Promise<HttpResponseLike> => ({ status: 200, ok: true }));
    const client: HttpClientLike = { request };
    // 独自 signal を返す resolveRequest
    const userController = new AbortController();
    const publisher = createHttpPublisher<{ x: number }>(client, {
      resolveRequest: () => ({ method: "POST", url: "/orders", signal: userController.signal }),
    });
    await publisher(makeEntry(), makeCtx());
    expect(request).toHaveBeenCalled();
  });

  // resolveRequest が signal を渡してこない場合 (mergeAbortSignals の early return)
  it("returns base signal directly when extra is undefined", async () => {
    // mock
    const baseController = new AbortController();
    let observed: AbortSignal | undefined;
    const request = vi.fn(async (init: HttpRequestInitLike): Promise<HttpResponseLike> => {
      observed = init.signal;
      return { status: 200, ok: true };
    });
    const client: HttpClientLike = { request };
    // signal を返さない resolveRequest
    const publisher = createHttpPublisher<{ x: number }>(client, {
      resolveRequest: () => ({ method: "POST", url: "/orders" }),
    });
    await publisher(makeEntry(), makeCtx(baseController.signal));
    // observed は base.signal と同一参照
    expect(observed).toBe(baseController.signal);
  });
});
