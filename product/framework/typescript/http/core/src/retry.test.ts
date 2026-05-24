// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import {
  DEFAULT_RETRYABLE_STATUSES,
  mergeRetryDefaults,
  sleep,
  withRetry,
} from "./retry.js";
import { HttpError } from "./errors.js";

describe("DEFAULT_RETRYABLE_STATUSES", () => {
  // 5xx + 408/425/429 の代表値
  it("代表ステータスを含む", () => {
    expect(DEFAULT_RETRYABLE_STATUSES).toContain(408);
    expect(DEFAULT_RETRYABLE_STATUSES).toContain(429);
    expect(DEFAULT_RETRYABLE_STATUSES).toContain(503);
  });
});

describe("mergeRetryDefaults", () => {
  // undefined を渡しても既定値で埋まる
  it("undefined を渡すと既定値で埋まる", () => {
    const p = mergeRetryDefaults(undefined);
    expect(p.maxRetries).toBe(3);
    expect(p.backoffBaseMs).toBe(200);
    expect(p.backoffMaxMs).toBe(10_000);
    expect(p.jitter).toBe("full");
    expect(p.retryableStatuses).toBe(DEFAULT_RETRYABLE_STATUSES);
  });
  // 部分上書き
  it("部分指定で上書きできる", () => {
    const p = mergeRetryDefaults({
      maxRetries: 5,
      jitter: "none",
      retryableStatuses: [500],
    });
    expect(p.maxRetries).toBe(5);
    expect(p.jitter).toBe("none");
    expect(p.retryableStatuses).toEqual([500]);
    // 未指定は既定値のまま
    expect(p.backoffBaseMs).toBe(200);
  });
});

describe("sleep", () => {
  // ms <= 0 は即時解決（タイマー登録なし）
  it("ms <= 0 は即時解決", async () => {
    await expect(sleep(0, undefined)).resolves.toBeUndefined();
    await expect(sleep(-1, undefined)).resolves.toBeUndefined();
  });
  // signal が既に abort 済みなら待たずに reject
  it("signal が既に abort 済みなら reject", async () => {
    const c = new AbortController();
    const reason = new DOMException("x", "AbortError");
    c.abort(reason);
    await expect(sleep(1000, c.signal)).rejects.toBe(reason);
  });
  // 通常の経過後 resolve
  it("通常は ms 経過後に resolve", async () => {
    vi.useFakeTimers();
    try {
      const p = sleep(100, undefined);
      await vi.advanceTimersByTimeAsync(100);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
  // 待機中に abort されたら reject
  it("待機中の abort で reject", async () => {
    vi.useFakeTimers();
    try {
      const c = new AbortController();
      const p = sleep(1000, c.signal);
      c.abort(new DOMException("x", "AbortError"));
      await expect(p).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      vi.useRealTimers();
    }
  });
  // signal なしかつ ms > 0
  it("signal なしでも abort リスナ解除しない経路を網羅", async () => {
    vi.useFakeTimers();
    try {
      const p = sleep(50, undefined);
      await vi.advanceTimersByTimeAsync(50);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
  // signal あり + 正常タイマー経過時のリスナ解除パス
  it("signal あり + 通常経過でリスナ解除パスを網羅", async () => {
    vi.useFakeTimers();
    try {
      const c = new AbortController();
      const p = sleep(50, c.signal);
      await vi.advanceTimersByTimeAsync(50);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withRetry", () => {
  // 試行 1 回で成功
  it("最初の試行で成功すればそのまま返す", async () => {
    const policy = mergeRetryDefaults({ maxRetries: 3, jitter: "none" });
    const attempt = vi.fn(async () => "ok");
    const out = await withRetry(policy, undefined, attempt);
    expect(out).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  // 1 度失敗して 2 度目に成功
  it("retryable エラー後に成功するまでリトライ", async () => {
    vi.useFakeTimers();
    try {
      const policy = mergeRetryDefaults({
        maxRetries: 3,
        backoffBaseMs: 10,
        jitter: "none",
      });
      let i = 0;
      const attempt = vi.fn(async () => {
        i++;
        if (i < 2) {
          throw new HttpError({
            message: "x",
            status: 503,
            retryable: true,
          });
        }
        return "ok";
      });
      const p = withRetry(policy, undefined, attempt);
      // 1 回目失敗 → backoff 10ms 待機
      await vi.advanceTimersByTimeAsync(10);
      await expect(p).resolves.toBe("ok");
      expect(attempt).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  // 非リトライエラーは即 throw
  it("非リトライエラーは即 throw（リトライしない）", async () => {
    const policy = mergeRetryDefaults({ maxRetries: 5, jitter: "none" });
    const attempt = vi.fn(async () => {
      throw new HttpError({ message: "no", status: 400, retryable: false });
    });
    await expect(withRetry(policy, undefined, attempt)).rejects.toMatchObject({
      status: 400,
    });
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  // maxRetries 到達で throw
  it("maxRetries 回まで試行して throw", async () => {
    vi.useFakeTimers();
    try {
      const policy = mergeRetryDefaults({
        maxRetries: 2,
        backoffBaseMs: 1,
        jitter: "none",
      });
      const attempt = vi.fn(async () => {
        throw new HttpError({ message: "x", status: 503, retryable: true });
      });
      const p = withRetry(policy, undefined, attempt);
      // rejection を先に捕捉しておく（unhandled rejection 警告の回避）
      const captured = p.catch((e: unknown) => e);
      // 2 回分の backoff（1ms + 2ms）
      await vi.advanceTimersByTimeAsync(10);
      const err = (await captured) as { status?: number };
      expect(err.status).toBe(503);
      // 試行は maxRetries+1 = 3 回
      expect(attempt).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  // shouldRetry が優先される
  it("shouldRetry が指定されればそれを優先", async () => {
    const policy = mergeRetryDefaults({
      maxRetries: 3,
      jitter: "none",
      shouldRetry: () => false,
    });
    const err = new HttpError({ message: "x", status: 503, retryable: true });
    const attempt = vi.fn(async () => {
      throw err;
    });
    await expect(withRetry(policy, undefined, attempt)).rejects.toBe(err);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
  // signal abort で即時中断
  it("親 signal が abort されたら即時 throw", async () => {
    const c = new AbortController();
    const policy = mergeRetryDefaults({ maxRetries: 3, jitter: "none" });
    const reason = new DOMException("x", "AbortError");
    c.abort(reason);
    await expect(
      withRetry(policy, c.signal, async () => "x"),
    ).rejects.toBe(reason);
  });
  // signal が abort 時に reason 未設定
  it("signal abort で reason 未設定なら AbortError を投げる", async () => {
    // reason を渡さずに abort
    const c = new AbortController();
    const policy = mergeRetryDefaults({ maxRetries: 3, jitter: "none" });
    // abort() の引数なしは reason が undefined ではなく DOMException が入ることが多いが、明示テスト
    c.abort();
    await expect(
      withRetry(policy, c.signal, async () => "x"),
    ).rejects.toBeInstanceOf(DOMException);
  });
  // jitter: "full" + 注入乱数で決定論化
  it("jitter:full と random 注入で待機時間を制御", async () => {
    vi.useFakeTimers();
    try {
      // random は常に 0.5 を返す → 待機時間 = exp * 0.5
      const policy = mergeRetryDefaults({
        maxRetries: 1,
        backoffBaseMs: 100,
        jitter: "full",
        random: () => 0.5,
      });
      let i = 0;
      const attempt = vi.fn(async () => {
        i++;
        if (i === 1) {
          throw new HttpError({ message: "x", status: 503, retryable: true });
        }
        return "ok";
      });
      const p = withRetry(policy, undefined, attempt);
      // 待機時間は 100 * 0.5 = 50ms
      await vi.advanceTimersByTimeAsync(50);
      await expect(p).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
  // random 未指定で Math.random をデフォルト使用するパス
  it("random 未指定でも待機して再試行（Math.random 経路）", async () => {
    vi.useFakeTimers();
    try {
      const policy = mergeRetryDefaults({
        maxRetries: 1,
        backoffBaseMs: 1,
        backoffMaxMs: 1,
        jitter: "full",
      });
      let i = 0;
      const attempt = vi.fn(async () => {
        i++;
        if (i === 1) {
          throw new HttpError({ message: "x", status: 503, retryable: true });
        }
        return "ok";
      });
      const p = withRetry(policy, undefined, attempt);
      // backoffMaxMs=1 なので 1ms 進めれば十分
      await vi.advanceTimersByTimeAsync(5);
      await expect(p).resolves.toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});
