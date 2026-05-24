// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { withTimeout } from "./timeout.js";

describe("withTimeout", () => {
  // ms 未指定なら素通し
  it("ms 未指定でも fn を子 signal 付きで実行する", async () => {
    const out = await withTimeout(undefined, undefined, async (signal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return 42;
    });
    expect(out).toBe(42);
  });

  // タイムアウト発火
  it("ms 経過後に DOMException(TimeoutError) で abort される", async () => {
    vi.useFakeTimers();
    try {
      const promise = withTimeout(100, undefined, async (signal) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        });
      });
      // 先に reject を捕捉しておく（unhandled rejection 警告の回避）
      const captured = promise.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(100);
      const err = (await captured) as { name: string };
      expect(err.name).toBe("TimeoutError");
    } finally {
      vi.useRealTimers();
    }
  });

  // 親 signal abort が子 signal に伝播
  it("parentSignal.abort() で子 signal も abort する", async () => {
    const parent = new AbortController();
    const promise = withTimeout(undefined, parent.signal, async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    });
    parent.abort(new DOMException("user", "AbortError"));
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  // parentSignal が既に abort 済み
  it("parentSignal が既に abort 済みでも子 signal に伝播する", async () => {
    const parent = new AbortController();
    parent.abort(new DOMException("pre", "AbortError"));
    const promise = withTimeout(undefined, parent.signal, async (signal) => {
      // 既に abort 済みのはず
      expect(signal.aborted).toBe(true);
      throw signal.reason;
    });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  // 成功時のクリーンアップ（タイマー解除）
  it("成功時にタイマーをクリアし parent リスナを解除する", async () => {
    const parent = new AbortController();
    const removeSpy = vi.spyOn(parent.signal, "removeEventListener");
    const out = await withTimeout(1000, parent.signal, async () => "ok");
    expect(out).toBe("ok");
    // 親 signal の abort リスナが解除されていること
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
