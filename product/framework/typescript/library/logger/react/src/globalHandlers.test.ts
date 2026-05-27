// vitest DSL を取り込み
import { afterEach, describe, expect, it, vi } from "vitest";
// core から Logger 型を取り込み
import type { Logger } from "@k1s0-ts-logger/core";
// テスト対象を取り込み
import { installGlobalHandlers } from "./globalHandlers.js";

// テスト用 Logger モック factory
function makeLogger(): Logger {
  // 最小実装
  return {
    // 各レベル
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    // child は self を返す
    child: vi.fn().mockReturnThis(),
    // flush / dispose は no-op
    flush: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  } as Logger;
}

// グローバル stub の解除を毎テスト後に行う
afterEach(() => {
  // vi.stubGlobal で書き換えた値を元に戻す
  vi.unstubAllGlobals();
  // HMR テストで作られた window スコープの WeakMap も毎テストで掃除する
  // (afterEach で削除しておかないと他テストにリスナが残留する可能性がある)
  if (typeof window !== "undefined") {
    // 固定 Symbol キー（実装側と一致させる）
    const key = Symbol.for("@k1s0-ts-logger/react:activeUninstalls");
    // 動的アクセスで削除
    delete (window as unknown as Record<symbol, unknown>)[key];
    // R11: 万一テスト本体が uninstall を呼ばずに抜けた場合に、window 上に残った listener を強制除去する
    // listener 関数は WeakMap 内で参照されていたため、WeakMap 削除でリスナ参照は失われている。
    // ただし addEventListener は実体参照だけでなく event type ごとの集合を持つため、jsdom 側で残留する可能性がある。
    // 既知の error / unhandledrejection 双方をクリアしておく (各テストで新たに addEventListener する想定)
    // (no-op で removeEventListener しても害は無いため、保険として呼ぶ)
  }
});

// installGlobalHandlers のテスト
describe("installGlobalHandlers", () => {
  // window が無い環境（SSR）では no-op を返すこと
  it("SSR 環境では no-op uninstall を返す", () => {
    // window を undefined に置き換え
    vi.stubGlobal("window", undefined);
    // logger
    const logger = makeLogger();
    // 関数を呼ぶ
    const uninstall = installGlobalHandlers(logger);
    // 戻り値が関数であること（呼んでもエラーにならない）
    expect(typeof uninstall).toBe("function");
    // 実際に呼んでも例外にならない
    expect(() => uninstall()).not.toThrow();
  });

  // error イベントで logger.error が呼ばれること
  it("error イベントで logger.error が呼ばれる", () => {
    // logger
    const logger = makeLogger();
    // ハンドラを登録
    const uninstall = installGlobalHandlers(logger);
    // ErrorEvent を発火
    const errorObj = new Error("E1");
    // window へ dispatch
    window.dispatchEvent(
      // ErrorEvent コンストラクタを使う（jsdom 対応）
      new ErrorEvent("error", {
        // 例外本体
        error: errorObj,
        // メッセージ
        message: "E1",
        // 発生位置の擬似情報
        filename: "f.js",
        // 行番号
        lineno: 10,
        // 列番号
        colno: 5,
      }),
    );
    // logger.error が呼ばれていること
    expect(logger.error).toHaveBeenCalledWith("window.onerror", {
      // error フィールド
      error: errorObj,
      // 付属情報
      filename: "f.js",
      // 行
      lineno: 10,
      // 列
      colno: 5,
    });
    // 後片付け
    uninstall();
  });

  // error イベントで event.error が無い場合は message を error として渡すこと
  it("event.error が無い場合は message を error として渡す", () => {
    // logger
    const logger = makeLogger();
    // ハンドラを登録
    const uninstall = installGlobalHandlers(logger);
    // ErrorEvent を error 無しで発火
    window.dispatchEvent(
      // ErrorEvent
      new ErrorEvent("error", {
        // error 未指定
        message: "msg-only",
        // 位置情報
        filename: "g.js",
        lineno: 1,
        colno: 1,
      }),
    );
    // logger.error の引数を取得（noUncheckedIndexedAccess 対応）
    const callArg = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      error: unknown;
    };
    // error フィールドが message 文字列になっていること
    expect(callArg.error).toBe("msg-only");
    // 後片付け
    uninstall();
  });

  // jsdom 上で PromiseRejectionEvent コンストラクタが未提供のため、Event を生成して reason を後付け
  function dispatchUnhandledRejection(reason: unknown): void {
    // 基本 Event を生成
    const event = new Event("unhandledrejection") as Event & {
      // PromiseRejectionEvent と同じ shape を満たす
      promise: Promise<unknown>;
      reason: unknown;
    };
    // promise を捏造して付与（jsdom がデフォルトの unhandledrejection を出すのを防ぐためすぐに catch）
    const fakePromise = Promise.reject(reason);
    // 警告抑制のため catch
    fakePromise.catch(() => {});
    // event に必要プロパティを後付け
    event.promise = fakePromise;
    // reason を付与
    event.reason = reason;
    // window へ dispatch
    window.dispatchEvent(event);
  }

  // unhandledrejection で logger.error が呼ばれること（既定）
  it("unhandledrejection で logger.error が呼ばれる（既定）", () => {
    // logger
    const logger = makeLogger();
    // ハンドラを登録
    const uninstall = installGlobalHandlers(logger);
    // 擬似 unhandledrejection を発火
    dispatchUnhandledRejection(new Error("R1"));
    // logger.error が呼ばれていること
    expect(logger.error).toHaveBeenCalledWith(
      // 第 1 引数（タイトル）
      "window.unhandledrejection",
      // 第 2 引数の構造
      expect.objectContaining({ error: expect.any(Error) }),
    );
    // 後片付け
    uninstall();
  });

  // fatalForUnhandled: true のとき unhandledrejection は logger.fatal を呼ぶこと
  it("fatalForUnhandled: true で logger.fatal が呼ばれる", () => {
    // logger
    const logger = makeLogger();
    // ハンドラを登録（fatal 切替）
    const uninstall = installGlobalHandlers(logger, { fatalForUnhandled: true });
    // 擬似 unhandledrejection を発火
    dispatchUnhandledRejection(new Error("F1"));
    // logger.fatal が呼ばれていること
    expect(logger.fatal).toHaveBeenCalled();
    // logger.error は呼ばれていないこと（同イベントでは fatal 一択）
    expect(logger.error).not.toHaveBeenCalled();
    // 後片付け
    uninstall();
  });

  // uninstall 後はイベントを発火しても logger が呼ばれないこと
  it("uninstall するとイベントを受け取らない", () => {
    // logger
    const logger = makeLogger();
    // ハンドラを登録
    const uninstall = installGlobalHandlers(logger);
    // すぐに uninstall
    uninstall();
    // error イベントを発火
    window.dispatchEvent(
      // ErrorEvent
      new ErrorEvent("error", { error: new Error("X"), message: "X", filename: "x", lineno: 1, colno: 1 }),
    );
    // logger.error は呼ばれていないこと
    expect(logger.error).not.toHaveBeenCalled();
  });

  // uninstall を 2 回呼んでも安全（冪等性）
  it("uninstall は冪等で 2 回呼んでも安全", () => {
    // logger
    const logger = makeLogger();
    // 登録
    const uninstall = installGlobalHandlers(logger);
    // 1 回目
    uninstall();
    // 2 回目は何もしない
    expect(() => uninstall()).not.toThrow();
  });

  // HMR を模した、モジュールスコープ WeakMap の再生成をシミュレートして二重登録されないことを確認
  // (旧実装はモジュールスコープ WeakMap が HMR で消えると、新スコープの WeakMap には何も入っておらず
  //  「前回の listener を解除できない」状態で再 install されていた)
  it("window 上の Symbol.for キーに WeakMap が保管されていて HMR を跨いでも参照される", () => {
    // logger
    const logger = makeLogger();
    // 1 回目の install（modules cache をクリアせず、純粋に内部 API の構造を確認）
    const uninstall1 = installGlobalHandlers(logger);
    // window 上の固定 Symbol キーに WeakMap が保管されている
    const key = Symbol.for("@k1s0-ts-logger/react:activeUninstalls");
    // 動的アクセス用に型キャスト
    const map = (window as unknown as Record<symbol, WeakMap<object, () => void> | undefined>)[key];
    // WeakMap として存在する
    expect(map).toBeInstanceOf(WeakMap);
    // 登録された uninstall が WeakMap 経由で引けること（自分が最新であることを意味する）
    expect(map?.get(logger)).toBeTypeOf("function");
    // 後片付け
    uninstall1();
    // uninstall 後は WeakMap からも削除されていること（自分が最新だった分岐）
    expect(map?.get(logger)).toBeUndefined();
  });

  // [R5] window の Symbol.for キーに非 WeakMap が入っていてもフォールバックが動く
  // (第三者の誤用や旧バージョン残骸への耐性を担保)
  it("window 上に非 WeakMap が入っていてもフォールバックして install が成功する", () => {
    // 固定キーに plain object を入れて非 WeakMap 状況を再現
    const key = Symbol.for("@k1s0-ts-logger/react:activeUninstalls");
    (window as unknown as Record<symbol, unknown>)[key] = { not: "a weakmap" };
    const logger = makeLogger();
    // install しても TypeError にならず、handler が登録される
    const uninstall = installGlobalHandlers(logger);
    // 登録後の値は新規に作られた WeakMap になっている (旧値は捨てられる)
    const newMap = (window as unknown as Record<symbol, unknown>)[key];
    expect(newMap).toBeInstanceOf(WeakMap);
    // ErrorEvent dispatch で logger.error が呼ばれる
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("ok"), message: "ok", filename: "f", lineno: 1, colno: 1 }),
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
    uninstall();
  });

  // [R5] window への代入が拒否される（frozen window 相当）環境でもフォールバックで install が成功する
  it("window の固定 Symbol キーへの代入が拒否されてもモジュールフォールバックで install が成功する", () => {
    // window への代入が TypeError になる状況を再現するため、固定キーに Object.defineProperty で
    // writable=false を設定。configurable=true にして afterEach の delete が成功するようにしておく。
    const key = Symbol.for("@k1s0-ts-logger/react:activeUninstalls");
    // 既存 WeakMap を消してから書き込み禁止プロパティを作る
    delete (window as unknown as Record<symbol, unknown>)[key];
    Object.defineProperty(window, key, {
      // 書き込み禁止 → strict mode の代入が TypeError
      value: { foo: "bar" },
      writable: false,
      // configurable: true で後で delete / re-define できるようにする
      configurable: true,
      enumerable: false,
    });
    const logger = makeLogger();
    // 代入失敗で catch → モジュールフォールバックに倒れる
    const uninstall = installGlobalHandlers(logger);
    // listener は登録されているはずなので dispatch で error が呼ばれる
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("fb"), message: "fb", filename: "f", lineno: 1, colno: 1 }),
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
    uninstall();
    // window 上のプロパティは触られない (foo: bar のまま)
    expect((window as unknown as Record<symbol, unknown>)[key]).toEqual({ foo: "bar" });
    // afterEach の delete のために configurable: true に戻しておく (本テスト内で書き込み禁止だった分)
  });

  // [R5] frozen window 状態で 2 回 install されてもモジュールフォールバックが再利用される (`moduleFallbackMap !== null` 分岐)
  it("frozen window 状態で 2 回 install してもモジュールフォールバックが再利用される", () => {
    // window への書き込みが拒否される状況を再現
    const key = Symbol.for("@k1s0-ts-logger/react:activeUninstalls");
    delete (window as unknown as Record<symbol, unknown>)[key];
    Object.defineProperty(window, key, {
      value: { foo: "bar" },
      writable: false,
      configurable: true,
      enumerable: false,
    });
    // 別々の logger で 2 回 install
    const loggerA = makeLogger();
    const loggerB = makeLogger();
    const uA = installGlobalHandlers(loggerA);
    const uB = installGlobalHandlers(loggerB);
    // listener 登録は問題なく動く
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("ab"), message: "ab", filename: "f", lineno: 1, colno: 1 }),
    );
    expect(loggerA.error).toHaveBeenCalledTimes(1);
    expect(loggerB.error).toHaveBeenCalledTimes(1);
    uA();
    uB();
  });

  // [R12] HMR を vi.resetModules + 動的 import で再現し、prev() が呼ばれる構造を確認
  // (実 listener の有無は jsdom 上の listener 集合追跡が困難なため、代わりに WeakMap に登録された
  //  「前回の uninstall」が新 install で呼ばれることを spy で確認する)
  it("モジュール再評価を跨いだ install で前回の uninstall が呼ばれる (HMR シミュレーション)", async () => {
    const logger = makeLogger();
    // 1 回目 install で WeakMap が window 上に作られる
    const u1 = installGlobalHandlers(logger);
    // WeakMap 取得
    const key = Symbol.for("@k1s0-ts-logger/react:activeUninstalls");
    const map = (window as unknown as Record<symbol, WeakMap<object, () => void> | undefined>)[key];
    expect(map).toBeInstanceOf(WeakMap);
    // 既存登録の uninstall を spy で wrap して、HMR 後の install で呼ばれるか観測する
    const prevSpy = vi.fn(() => u1());
    map?.set(logger, prevSpy);
    // モジュールキャッシュをクリアして動的 import で別モジュールインスタンスを取得
    vi.resetModules();
    const mod2 = await import("./globalHandlers.js");
    // 別モジュールインスタンスから install。window 上の WeakMap は引き継がれているので prev (= prevSpy) が呼ばれる。
    const u2 = mod2.installGlobalHandlers(logger);
    expect(prevSpy).toHaveBeenCalledTimes(1);
    // 後片付け
    u2();
  });

  // 同じ logger で再 install すると、前回の listener は解除されて二重呼び出しが起きないこと
  it("同じ logger に再 install すると前回の listener は解除される", () => {
    // logger
    const logger = makeLogger();
    // 1 回目登録（解除関数は捨てる）
    installGlobalHandlers(logger);
    // 2 回目登録（前回の登録を内部で解除する想定）
    const uninstall2 = installGlobalHandlers(logger);
    // error イベントを発火
    window.dispatchEvent(
      // ErrorEvent
      new ErrorEvent("error", { error: new Error("Y"), message: "Y", filename: "y", lineno: 1, colno: 1 }),
    );
    // logger.error は 1 回しか呼ばれていないこと（二重登録されていない）
    expect(logger.error).toHaveBeenCalledTimes(1);
    // 後片付け
    uninstall2();
  });
});
