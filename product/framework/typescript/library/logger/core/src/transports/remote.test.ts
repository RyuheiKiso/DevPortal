// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { createRemoteTransport } from "./remote.js";
// 型を取り込み
import type { LogEntry } from "../types.js";
// タイマーフェイク用
import type { BatcherTimer } from "../batcher.js";

// 簡易エントリ
function entry(message: string): LogEntry {
  return { level: "info", message, timestamp: 0 };
}

// マイクロタスクを十分に消費するヘルパ
async function flushMicrotasks(times = 10) {
  // 連続して await を入れて、内部の非同期チェーンを進める
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

// テスト用フェイクタイマー（手動発火型）
function makeFakeTimer() {
  // 登録されたコールバック
  const callbacks: Array<{ id: number; cb: () => void }> = [];
  let nextId = 1;
  const timer: BatcherTimer = {
    set: (cb) => {
      const id = nextId++;
      callbacks.push({ id, cb });
      return id;
    },
    clear: (handle) => {
      const idx = callbacks.findIndex((c) => c.id === handle);
      if (idx >= 0) callbacks.splice(idx, 1);
    },
  };
  const runAll = () => {
    const fired = callbacks.splice(0, callbacks.length);
    fired.forEach((c) => c.cb());
  };
  return { timer, runAll };
}

// 成功レスポンスを返す fetch
function makeOkFetch() {
  return vi.fn(async () =>
    // 200 ok のダミー Response
    ({ ok: true, status: 200 } as unknown as Response),
  );
}

describe("createRemoteTransport", () => {
  // name 既定
  it("name は 'remote'", () => {
    const t = createRemoteTransport({ endpoint: "http://x", fetchImpl: makeOkFetch() });
    expect(t.name).toBe("remote");
  });

  // flushSize 到達で送信
  it("flushSize 到達で fetch が 1 回呼ばれる", async () => {
    const fetchImpl = makeOkFetch();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 2,
      flushIntervalMs: undefined,
    });
    t.write(entry("a"));
    t.write(entry("b"));
    // 非同期チェーンを進める
    await flushMicrotasks();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 呼び出しの URL と method を確認
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://x");
    expect(init?.method).toBe("POST");
  });

  // ヘッダがマージされる
  it("headers が fetch に渡る（既定 Content-Type と統合）", async () => {
    const fetchImpl = makeOkFetch();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
      headers: { "X-Token": "abc" },
    });
    t.write(entry("a"));
    await flushMicrotasks();
    const init = fetchImpl.mock.calls[0]?.[1];
    // 既定の Content-Type は残る
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    // 追加ヘッダも乗る
    expect((init?.headers as Record<string, string>)["X-Token"]).toBe("abc");
  });

  // 既定 serialize の出力形式
  it("既定 serialize で {entries:[...]} の JSON が body になる", async () => {
    const fetchImpl = makeOkFetch();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
    });
    t.write(entry("hello"));
    await flushMicrotasks();
    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(init!.body as string);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].message).toBe("hello");
  });

  // serialize 注入で形式を変えられる
  it("serialize 注入で任意の body にできる", async () => {
    const fetchImpl = makeOkFetch();
    const serialize = vi.fn(() => "custom-body");
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
      serialize,
    });
    t.write(entry("a"));
    await flushMicrotasks();
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe("custom-body");
  });

  // インターバル発火で送信
  it("flushIntervalMs 経過で送信される", async () => {
    const fetchImpl = makeOkFetch();
    const { timer, runAll } = makeFakeTimer();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 100,
      flushIntervalMs: 100,
      timer,
    });
    t.write(entry("a"));
    // タイマー未発火
    expect(fetchImpl).not.toHaveBeenCalled();
    // タイマー発火
    runAll();
    await flushMicrotasks();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // 5xx でリトライ
  it("5xx 応答ではリトライされる", async () => {
    // 1 回目 500、2 回目 200
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);
    // バックオフ待機のタイマーは即時発火
    const { timer, runAll } = makeFakeTimer();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
      maxRetries: 2,
      backoffBaseMs: 10,
      random: () => 0,
      timer,
    });
    t.write(entry("a"));
    // 1 回目の fetch を解決する
    await flushMicrotasks();
    // 待機タイマーを発火
    runAll();
    // 2 回目の fetch を解決する
    await flushMicrotasks();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // 4xx はリトライしない（既定 shouldRetry）
  // 4xx は永続失敗扱いで items を破棄し、flush は正常終了する
  // (旧実装は items を batcher にリバッファして無限再送 → 全件失敗ループになっていた)
  // 観測は onPermanentFailure コールバックで行う
  it("4xx 応答では永続失敗として items を破棄し、flush は正常終了する", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: false, status: 400 } as unknown as Response));
    // 永続失敗の通知を観測する spy
    const permanentFailures: Array<{ error: unknown; items: readonly unknown[] }> = [];
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 100,
      maxRetries: 5,
      onPermanentFailure: (error, items) => {
        permanentFailures.push({ error, items });
      },
    });
    t.write(entry("a"));
    // flush は items 破棄により正常終了する
    await expect(t.flush()).resolves.toBeUndefined();
    // fetch は 1 回しか呼ばれない (リトライしていない)
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 永続失敗が通知されている (items 1 件)
    expect(permanentFailures).toHaveLength(1);
    expect(permanentFailures[0]?.items).toHaveLength(1);
  });

  // fetch が throw した場合もリトライ対象
  it("fetch が throw するとネットワーク扱いでリトライ", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);
    const { timer, runAll } = makeFakeTimer();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
      maxRetries: 2,
      backoffBaseMs: 1,
      random: () => 0.5,
      timer,
    });
    t.write(entry("a"));
    await flushMicrotasks();
    runAll();
    await flushMicrotasks();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // onPermanentFailure コールバックが throw しても flush は正常終了する
  it("onPermanentFailure コールバックの例外は飲み込まれて flush は正常終了する", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: false, status: 400 } as unknown as Response));
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 100,
      maxRetries: 0,
      onPermanentFailure: () => {
        // 観測コールバックが例外を投げてもユーザコードに影響しないことを確認
        throw new Error("callback exploded");
      },
    });
    t.write(entry("a"));
    // コールバック例外は飲み込まれ、flush は正常終了する
    await expect(t.flush()).resolves.toBeUndefined();
  });

  // shouldRetry を false に固定すると永続失敗扱いで items を破棄、flush は正常終了
  it("shouldRetry が false なら永続失敗として items を破棄し flush は正常終了する", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: false, status: 500 } as unknown as Response));
    const permanentFailures: Array<{ error: unknown; items: readonly unknown[] }> = [];
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 100,
      maxRetries: 5,
      shouldRetry: () => false,
      onPermanentFailure: (error, items) => {
        permanentFailures.push({ error, items });
      },
    });
    t.write(entry("a"));
    // 永続失敗 → items 破棄 → flush は resolve する
    await expect(t.flush()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 永続失敗の通知 1 件
    expect(permanentFailures).toHaveLength(1);
  });

  // リトライ上限到達で reject
  it("maxRetries 到達後に flush が reject する", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: false, status: 500 } as unknown as Response));
    // タイマーは即時発火
    const { timer, runAll } = makeFakeTimer();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 100,
      maxRetries: 2,
      backoffBaseMs: 1,
      random: () => 0,
      timer,
    });
    t.write(entry("a"));
    // 明示 flush を発火させる
    const flushed = t.flush();
    // 各 fetch 呼び出しと待機を順に進める
    for (let i = 0; i < 5; i++) {
      await flushMicrotasks();
      runAll();
    }
    await expect(flushed).rejects.toBeDefined();
    // 1 回目 + 2 回のリトライ = 計 3 回
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  // dispose でタイマー停止 + 残バッファ送信
  it("dispose で残バッファが送信される", async () => {
    const fetchImpl = makeOkFetch();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 100,
      flushIntervalMs: 1000,
    });
    t.write(entry("a"));
    await t.dispose();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // 連続 push の in-flight ガード（送信を直列化）
  it("送信中に新規 write が来ても二重送信ではなく直列化される", async () => {
    // 1 回目の fetch は遅延、2 回目は即時
    let resolveFirst!: (v: Response) => void;
    const firstPromise = new Promise<Response>((resolve) => {
      resolveFirst = resolve as (v: Response) => void;
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
    });
    // 1 件目: flushSize=1 で即送信開始（in-flight）
    t.write(entry("a"));
    // マイクロタスク 1 サイクルで sending が設定される
    await flushMicrotasks();
    // この時点で fetch は 1 回呼ばれている（in-flight 状態）
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 2 件目: in-flight ガードで前回完了を待つ状態に入る
    t.write(entry("b"));
    await flushMicrotasks();
    // まだ 1 回のまま（直列化されて待機中）
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 1 回目を完了させる
    resolveFirst({ ok: true, status: 200 } as unknown as Response);
    // 2 回目の送信が走りきるのを待つ
    await flushMicrotasks(20);
    // 計 2 回呼ばれ、直列に処理されている
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // fetchImpl 未指定でグローバル fetch を使う
  it("fetchImpl 未指定の場合は globalThis.fetch を使う", async () => {
    // グローバルにダミー fetch を差し込む
    const original = globalThis.fetch;
    const spy = vi.fn(async () => ({ ok: true, status: 200 } as unknown as Response));
    (globalThis as { fetch?: typeof fetch }).fetch = spy as unknown as typeof fetch;
    try {
      const t = createRemoteTransport({
        endpoint: "http://x",
        flushSize: 1,
      });
      t.write(entry("a"));
      await flushMicrotasks();
      expect(spy).toHaveBeenCalled();
    } finally {
      // 元に戻す
      (globalThis as { fetch?: typeof fetch }).fetch = original;
    }
  });

  // timer 未指定でも動作する（setTimeout 経由のインターバル）
  it("timer 未指定でも flushIntervalMs が動く", async () => {
    // 実時間タイマーを使うため短い遅延で確認
    const fetchImpl = makeOkFetch();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 100,
      flushIntervalMs: 5,
    });
    t.write(entry("a"));
    // 実時間で十分待機
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // 成功する flush() でも resolve する
  it("バッファに残った状態で flush() を呼ぶと成功する", async () => {
    const fetchImpl = makeOkFetch();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 100,
    });
    t.write(entry("a"));
    t.write(entry("b"));
    await expect(t.flush()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // flush は in-flight sending（タイマー駆動など）の完了も待つ
  it("flush は別経路で進行中の sending を待つ", async () => {
    // 1 回目の fetch を遅延させる
    let resolveFetch!: (v: Response) => void;
    const firstFetch = new Promise<Response>((r) => {
      resolveFetch = r as (v: Response) => void;
    });
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValueOnce(firstFetch);
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
    });
    // 1 件 write で sendBatch が走る（fetch は pending）
    t.write(entry("a"));
    await flushMicrotasks();
    // flush を呼ぶ。batcher.flush は no-op だが、sending 待ちで未完
    let flushDone = false;
    const flushPromise = t.flush().then(() => {
      flushDone = true;
    });
    // まだ flush は完了していない
    await flushMicrotasks();
    expect(flushDone).toBe(false);
    // fetch を解決
    resolveFetch({ ok: true, status: 200 } as unknown as Response);
    await flushPromise;
    expect(flushDone).toBe(true);
  });

  // dispose 中のバックオフ wait は aborted で即時抜けてリトライ打ち切り
  it("dispose 中のバックオフ wait は中断されてリトライが止まる", async () => {
    // 常に 500 を返す fetch
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: false, status: 500 } as unknown as Response));
    // フェイクタイマーを使う
    const { timer } = makeFakeTimer();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
      maxRetries: 5,
      backoffBaseMs: 1000,
      random: () => 0,
      timer,
    });
    t.write(entry("a"));
    // 1 回目の fetch を完了させる
    await flushMicrotasks();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // バックオフ wait 中のはず。dispose で中断
    await t.dispose();
    // dispose 後はリトライが進まないはず（追加の fetch は呼ばれない）
    await flushMicrotasks(5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // dispose の初回送信は走る（残バッファが空でなければ）
  it("dispose で残バッファの初回送信は走る（リトライは打ち切られる）", async () => {
    const fetchImpl = makeOkFetch();
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 100,
    });
    t.write(entry("a"));
    await t.dispose();
    // 残バッファの送信が 1 回試みられている
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // dispose 中に sending が resolve すれば while ループから抜ける（成功パス）
  it("dispose 中の sending が resolve したらループから抜ける", async () => {
    let resolveFetch!: (v: Response) => void;
    const slowFetch = new Promise<Response>((r) => {
      resolveFetch = r as (v: Response) => void;
    });
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValueOnce(slowFetch);
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
    });
    t.write(entry("a"));
    await flushMicrotasks();
    // dispose は sending を await する
    const disposed = t.dispose();
    await flushMicrotasks();
    // fetch を成功で解決
    resolveFetch({ ok: true, status: 200 } as unknown as Response);
    await expect(disposed).resolves.toBeUndefined();
  });

  // dispose 後に sending が reject しても握りつぶされる（while(sending) の catch カバー）
  it("dispose 中の sending が reject しても握りつぶされる", async () => {
    // 1 回目の fetch を pending のままにする
    let rejectFetch!: (e: unknown) => void;
    const slowFetch = new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject;
    });
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValueOnce(slowFetch);
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
      maxRetries: 0,
    });
    t.write(entry("a"));
    await flushMicrotasks();
    // 1 回目の fetch が in-flight
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // dispose を起動（中で while(sending) ループに入る）
    const disposed = t.dispose();
    // 微小に進めてから fetch を reject
    await flushMicrotasks();
    rejectFetch(new Error("net"));
    // dispose は reject を握りつぶして resolve する
    await expect(disposed).resolves.toBeUndefined();
  });

  // dispose 中の wait abort + batcher.dispose catch + sending catch をまとめて踏む
  it("dispose 中の wait が disposed で即時 abort、関連 reject はすべて握りつぶされる", async () => {
    // 常に 500 を返す fetch（リトライ可、shouldRetry 既定で 5xx なのでリトライ判定）
    const fetchImpl = vi.fn<typeof fetch>(async () => ({ ok: false, status: 500 } as unknown as Response));
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 100,
      maxRetries: 3,
      backoffBaseMs: 1,
      random: () => 0,
    });
    t.write(entry("a"));
    // dispose を呼ぶ → 残バッファ送信が試みられ、バックオフ wait は disposed で abort
    await expect(t.dispose()).resolves.toBeUndefined();
    // 初回送信のみ（バックオフ後のリトライは打ち切り）
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // 3 件以上の同時 onFlush でも sendBatch が直列に呼ばれる
  it("3 件以上の同時 onFlush でも sendBatch が直列化される", async () => {
    // 各 fetch を手動で解決するため Deferred 群を用意
    type Deferred = { promise: Promise<Response>; resolve: (v: Response) => void };
    const deferreds: Deferred[] = [];
    const makeDef = (): Deferred => {
      let resolve!: (v: Response) => void;
      const promise = new Promise<Response>((r) => {
        resolve = r as (v: Response) => void;
      });
      return { promise, resolve };
    };
    const fetchImpl = vi.fn<typeof fetch>(() => {
      const d = makeDef();
      deferreds.push(d);
      return d.promise;
    });
    const t = createRemoteTransport({
      endpoint: "http://x",
      fetchImpl,
      flushSize: 1,
    });
    // 3 件を立て続けに write し、それぞれが onFlush を起動
    t.write(entry("a"));
    t.write(entry("b"));
    t.write(entry("c"));
    await flushMicrotasks();
    // 直列化されているので最初の fetch のみ呼ばれている
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // 1 件目完了
    deferreds[0]!.resolve({ ok: true, status: 200 } as unknown as Response);
    await flushMicrotasks();
    // 2 件目が呼ばれる
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    deferreds[1]!.resolve({ ok: true, status: 200 } as unknown as Response);
    await flushMicrotasks();
    // 3 件目が呼ばれる
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    deferreds[2]!.resolve({ ok: true, status: 200 } as unknown as Response);
    await flushMicrotasks();
  });
});
