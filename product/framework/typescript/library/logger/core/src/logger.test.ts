// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { createLogger } from "./logger.js";
// 型を取り込み
import type { LogEntry, Transport } from "./types.js";

// 書き込まれたエントリを記録するテスト用 transport
function recordingTransport(name = "rec"): Transport & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    name,
    write: (e) => {
      // 受け取ったまま積む
      entries.push(e);
    },
    entries,
  } as Transport & { entries: LogEntry[] };
}

describe("createLogger", () => {
  // 各レベルのメソッドが transport.write を呼ぶ
  it("各レベルメソッドが transport.write を呼ぶ", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      transports: [t],
      now: () => 100,
    });
    logger.trace("a");
    logger.debug("b");
    logger.info("c");
    logger.warn("d");
    logger.error("e");
    logger.fatal("f");
    expect(t.entries.map((x) => x.level)).toEqual(["trace", "debug", "info", "warn", "error", "fatal"]);
  });

  // timestamp と level/message が正しく入る
  it("LogEntry の level/message/timestamp が正しい", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      transports: [t],
      now: () => 12345,
    });
    logger.info("hello");
    expect(t.entries[0]).toMatchObject({ level: "info", message: "hello", timestamp: 12345 });
  });

  // tags / context が config から付与される
  it("config の tags/context が全エントリに付与される", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      tags: ["root"],
      context: { app: "x" },
      transports: [t],
    });
    logger.info("a");
    expect(t.entries[0]?.tags).toEqual(["root"]);
    expect(t.entries[0]?.context).toEqual({ app: "x" });
  });

  // フィルタで弾かれたエントリは transport.write が呼ばれない
  it("レベルフィルタで弾かれたエントリは write を呼ばない", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "prod",
      envLevels: { prod: "warn" },
      transports: [t],
    });
    logger.info("filtered");
    logger.warn("kept");
    expect(t.entries).toHaveLength(1);
    expect(t.entries[0]?.message).toBe("kept");
  });

  // data から error フィールドが Error として正規化される
  it("data.error に Error を渡すと entry.error が name/message/stack で展開される", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      transports: [t],
    });
    const err = new Error("boom");
    logger.error("oops", { error: err, requestId: "r1" });
    const e = t.entries[0]!;
    expect(e.error?.name).toBe("Error");
    expect(e.error?.message).toBe("boom");
    // meta には error 以外のキーが入る
    expect(e.meta).toEqual({ requestId: "r1" });
  });

  // data.error が Error 以外でも文字列化される
  it("data.error に Error 以外を渡しても文字列化される", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      transports: [t],
    });
    logger.error("oops", { error: "string-error" });
    const e = t.entries[0]!;
    expect(e.error?.name).toBe("Error");
    expect(e.error?.message).toBe("string-error");
  });

  // data が undefined ならエラー/メタは undefined のまま
  it("data 未指定なら error / meta は undefined", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    logger.info("plain");
    const e = t.entries[0]!;
    expect(e.error).toBeUndefined();
    expect(e.meta).toBeUndefined();
  });

  // data に error のみ渡した場合は meta が undefined
  it("data.error のみ渡した場合は meta が undefined", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    logger.error("e", { error: new Error("only") });
    expect(t.entries[0]?.meta).toBeUndefined();
  });

  // child でタグ・コンテキストが結合される
  it("child でタグ/コンテキストが親と結合される", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      tags: ["root"],
      context: { app: "x" },
      transports: [t],
    });
    const child = logger.child({ tags: ["req"], context: { reqId: "1" } });
    child.info("a");
    expect(t.entries[0]?.tags).toEqual(["root", "req"]);
    expect(t.entries[0]?.context).toEqual({ app: "x", reqId: "1" });
  });

  // child の child でも親バインディングが累積する
  it("child の child でバインディングが累積する", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      transports: [t],
    });
    const grand = logger.child({ tags: ["a"] }).child({ tags: ["b"] });
    grand.info("x");
    expect(t.entries[0]?.tags).toEqual(["a", "b"]);
  });

  // 親が空でも子だけのバインディングが入る
  it("親が tags/context を持たなくても子の値が入る", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    const c = logger.child({ tags: ["only-child"], context: { k: "v" } });
    c.info("x");
    expect(t.entries[0]?.tags).toEqual(["only-child"]);
    expect(t.entries[0]?.context).toEqual({ k: "v" });
  });

  // 親 tags/context だけで子が空の場合
  it("子が空のバインディングでも親の値が引き継がれる", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      tags: ["root"],
      transports: [t],
    });
    const c = logger.child({});
    c.info("x");
    expect(t.entries[0]?.tags).toEqual(["root"]);
  });

  // 親も子も tags/context を持たないとエントリは undefined のまま
  it("親も子も tags/context を持たない場合は entry にも undefined", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      transports: [t],
    });
    const c = logger.child({});
    c.info("x");
    expect(t.entries[0]?.tags).toBeUndefined();
    expect(t.entries[0]?.context).toBeUndefined();
  });

  // 親 context あり / 子 context なし のパス
  it("親 context のみで子が空の場合、親 context が引き継がれる", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      context: { app: "x" },
      transports: [t],
    });
    const c = logger.child({ tags: ["only-tags"] });
    c.info("x");
    expect(t.entries[0]?.context).toEqual({ app: "x" });
    expect(t.entries[0]?.tags).toEqual(["only-tags"]);
  });

  // transport.write が throw すると onTransportError へ
  it("transport.write が throw すると onTransportError に通知される", async () => {
    // throw する transport
    const bad: Transport = {
      name: "bad",
      write: () => {
        throw new Error("bad");
      },
    };
    // 健全な transport
    const ok = recordingTransport("ok");
    const onTransportError = vi.fn();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      transports: [bad, ok],
      onTransportError,
    });
    logger.info("x");
    // 非同期チェーンを進めて捕捉を確実にする
    await Promise.resolve();
    expect(onTransportError).toHaveBeenCalledTimes(1);
    // 健全な transport は影響を受けない
    expect(ok.entries).toHaveLength(1);
  });

  // onTransportError 未指定でも write 失敗が握りつぶされる
  it("onTransportError 未指定でも write の例外は握りつぶされる", async () => {
    const bad: Transport = {
      name: "bad",
      write: () => {
        throw new Error("silent");
      },
    };
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [bad] });
    // 例外が外に漏れないこと
    expect(() => logger.info("x")).not.toThrow();
    await Promise.resolve();
  });

  // flush / dispose が全 transport で呼ばれる
  it("flush と dispose が全 transport で実行される", async () => {
    const flush = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    const t: Transport = { name: "t", write: () => {}, flush, dispose };
    const logger = createLogger({ env: "dev", transports: [t] });
    await logger.flush();
    await logger.dispose();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  // flush / dispose 未実装の transport はスキップされる
  it("flush/dispose 未実装の transport はスキップされる", async () => {
    const t: Transport = { name: "t", write: () => {} };
    const logger = createLogger({ env: "dev", transports: [t] });
    // 例外が出ないこと
    await expect(logger.flush()).resolves.toBeUndefined();
    await expect(logger.dispose()).resolves.toBeUndefined();
  });

  // flush で transport が reject すると onTransportError が呼ばれ、戻り値は AggregateError で reject
  it("flush で transport が reject すると AggregateError を投げ、onTransportError も呼ばれる", async () => {
    const onTransportError = vi.fn();
    const good: Transport = { name: "good", write: () => {}, flush: async () => {} };
    const bad: Transport = {
      name: "bad",
      write: () => {},
      flush: async () => {
        throw new Error("flush-bad");
      },
    };
    const logger = createLogger({
      env: "dev",
      transports: [good, bad],
      onTransportError,
    });
    // AggregateError で reject することを確認
    await expect(logger.flush()).rejects.toBeInstanceOf(AggregateError);
    // onTransportError も呼ばれる
    expect(onTransportError).toHaveBeenCalledTimes(1);
    expect(onTransportError.mock.calls[0]?.[0]).toBe(bad);
    expect(onTransportError.mock.calls[0]?.[1]).toBeNull();
  });

  // dispose で reject すると AggregateError を投げる
  it("dispose で transport が reject すると AggregateError を投げる", async () => {
    const bad: Transport = {
      name: "bad",
      write: () => {},
      dispose: async () => {
        throw new Error("dispose-bad");
      },
    };
    const logger = createLogger({ env: "dev", transports: [bad] });
    // AggregateError で reject することを確認
    await expect(logger.dispose()).rejects.toBeInstanceOf(AggregateError);
  });

  // now を注入しない場合はグローバル Date.now を使う
  it("now を注入しない場合は Date.now が使われる", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(999);
    try {
      const t = recordingTransport();
      const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
      logger.info("x");
      expect(t.entries[0]?.timestamp).toBe(999);
    } finally {
      spy.mockRestore();
    }
  });

  // child.flush() と child.dispose() は no-op であり、共有 transports は停止しない
  it("child の flush と dispose は no-op で transports は停止しない", async () => {
    const flush = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    const t: Transport = { name: "t", write: () => {}, flush, dispose };
    const logger = createLogger({ env: "dev", transports: [t] });
    // child を生成
    const child = logger.child({ tags: ["c"] });
    // child の flush/dispose は何もしない
    await child.flush();
    await child.dispose();
    // transport の flush/dispose は呼ばれていない
    expect(flush).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    // ルートの flush/dispose は通常通り呼ばれる
    await logger.flush();
    expect(flush).toHaveBeenCalledTimes(1);
    await logger.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  // flush は進行中の async transport.write 完了を待つ
  it("flush は進行中の async transport.write を待つ", async () => {
    // write が解決するまで保持する遅延 Promise
    let resolveWrite!: () => void;
    const writePromise = new Promise<void>((r) => {
      resolveWrite = r;
    });
    // write が呼ばれた事実を記録
    const writeCalls: string[] = [];
    const slow: Transport = {
      name: "slow",
      // write は writePromise を await してから完了
      async write(entry) {
        await writePromise;
        writeCalls.push(entry.message);
      },
    };
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [slow] });
    // info を発行（write は suspend する）
    logger.info("A");
    // この時点では write はまだ完了していない
    expect(writeCalls).toEqual([]);
    // flush 呼び出し
    const flushPromise = logger.flush();
    // writePromise を解決すると write 内の push が完了
    resolveWrite();
    // flush の完了を待つ
    await flushPromise;
    // flush 完了時点で writeCalls に 'A' が入っている
    expect(writeCalls).toEqual(["A"]);
  });

  // mergeBindings の tags 重複は除去される
  it("child の tags は親と重複していたら除去される", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      tags: ["a", "b"],
      transports: [t],
    });
    const child = logger.child({ tags: ["b", "c"] });
    child.info("x");
    // 'b' の重複が除去されていること
    expect(t.entries[0]?.tags).toEqual(["a", "b", "c"]);
  });

  // [R8] 親が空配列 tags を持ち、子が tags 未指定のとき、entry.tags は undefined に正規化される
  // (mergeBindings 自体は空配列を保持するが、emit() 時に「undefined または非空」に倒すことで
  //  下流の serializer (JSON.stringify, 旧版との互換性) を安定させる)
  it("親 tags=[] / 子 tags 未指定の最終 entry.tags は undefined に正規化される (R8)", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      tags: [],
      transports: [t],
    });
    const child = logger.child({});
    child.info("x");
    // 空配列は undefined に倒される
    expect(t.entries[0]?.tags).toBeUndefined();
  });

  // [R8] 親が空オブジェクト context を持ち、子が context 未指定のとき、entry.context は undefined に正規化される
  it("親 context={} / 子 context 未指定の最終 entry.context は undefined に正規化される (R8)", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      context: {},
      transports: [t],
    });
    const child = logger.child({});
    child.info("x");
    expect(t.entries[0]?.context).toBeUndefined();
  });

  // [R9] child で `{ traceId: undefined }` を渡しても親の traceId が消えない
  // (mergeBindings の浅マージで child の undefined キーが parent を上書きしないようフィルタしている)
  it("child の context に undefined キーを渡しても parent.context の同名値は保持される (R9)", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      context: { traceId: "abc", userId: "u1" },
      transports: [t],
    });
    // child で「traceId だけ unset しよう」とした意図的なケース（実際は unset されない仕様にする）
    const child = logger.child({ context: { traceId: undefined } });
    child.info("x");
    // traceId は親の値が保持される
    expect(t.entries[0]?.context).toEqual({ traceId: "abc", userId: "u1" });
  });

  // [R9] child の context に通常の値を渡せば parent の同名キーが上書きされる
  it("child の context に通常値を渡すと parent の同名キーが上書きされる", () => {
    const t = recordingTransport();
    const logger = createLogger({
      env: "dev",
      defaultMinLevel: "trace",
      context: { reqId: "r1" },
      transports: [t],
    });
    const child = logger.child({ context: { reqId: "r2", extra: 1 } });
    child.info("x");
    expect(t.entries[0]?.context).toEqual({ reqId: "r2", extra: 1 });
  });

  // normalizeError: null と undefined
  it("normalizeError: null/undefined は 'null'/'undefined' に文字列化される", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    logger.error("e1", { error: null });
    logger.error("e2", { error: undefined });
    expect(t.entries[0]?.error?.message).toBe("null");
    // undefined を error に渡しても data の分解段階で rawError===undefined となり、entry.error は undefined になる
    expect(t.entries[1]?.error).toBeUndefined();
  });

  // normalizeError: Symbol を渡すと toString される
  it("normalizeError: Symbol は文字列化される", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    const s = Symbol("alpha");
    logger.error("e", { error: s });
    expect(t.entries[0]?.error?.message).toContain("alpha");
  });

  // normalizeError: Symbol の toString が throw する場合は固定文字列にフォールバック
  it("normalizeError: Symbol.toString が throw すると '[symbol]' にフォールバック", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    // Symbol.prototype.toString を一時的に throw する実装に差し替える
    const spy = vi.spyOn(Symbol.prototype, "toString").mockImplementation(() => {
      throw new Error("boom");
    });
    try {
      logger.error("e", { error: Symbol("x") });
      expect(t.entries[0]?.error?.message).toBe("[symbol]");
    } finally {
      spy.mockRestore();
    }
  });

  // normalizeError: cross-realm 風の duck-typed Error
  it("normalizeError: name/message/stack を持つ素のオブジェクトを Error として正規化", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    const fake = { name: "DOMException", message: "blocked", stack: "fake-stack" };
    logger.error("e", { error: fake });
    expect(t.entries[0]?.error).toEqual({ name: "DOMException", message: "blocked", stack: "fake-stack" });
  });

  // normalizeError: name 欠落でも duck-typed Error を受ける
  it("normalizeError: name が欠けた duck-typed Error は既定 'Error' を使う", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    logger.error("e", { error: { message: "no-name" } });
    expect(t.entries[0]?.error?.name).toBe("Error");
    expect(t.entries[0]?.error?.message).toBe("no-name");
  });

  // normalizeError: message が文字列以外でも文字列化されて受ける
  it("normalizeError: 非文字列 message を持つオブジェクトも文字列化される", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    logger.error("e", { error: { message: 42 } });
    expect(t.entries[0]?.error?.message).toBe("42");
  });

  // normalizeError: stack が文字列以外なら undefined にする
  it("normalizeError: stack が文字列以外なら undefined", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    logger.error("e", { error: { message: "x", stack: 123 } });
    expect(t.entries[0]?.error?.stack).toBeUndefined();
  });

  // normalizeError: プレーンオブジェクト（message 無し）は JSON.stringify
  it("normalizeError: message 無しのプレーンオブジェクトは JSON.stringify される", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    logger.error("e", { error: { code: "EFAIL", detail: { x: 1 } } });
    expect(t.entries[0]?.error?.message).toBe('{"code":"EFAIL","detail":{"x":1}}');
  });

  // normalizeError: 循環参照のオブジェクトは toString フォールバック
  it("normalizeError: 循環参照は toString にフォールバック", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    const obj: { self?: unknown } = {};
    obj.self = obj;
    logger.error("e", { error: obj });
    expect(t.entries[0]?.error?.message).toBe("[object Object]");
  });

  // normalizeError: プリミティブ（数値）は String() で文字列化
  it("normalizeError: プリミティブ数値は文字列化される", () => {
    const t = recordingTransport();
    const logger = createLogger({ env: "dev", defaultMinLevel: "trace", transports: [t] });
    logger.error("e", { error: 42 });
    expect(t.entries[0]?.error?.message).toBe("42");
  });
});
