// vitest DSL を取り込み
import { describe, expect, it, vi } from "vitest";
// テスト対象
import { createBatcher, type BatcherTimer } from "./batcher.js";

// タイマーを完全制御するためのフェイク実装
function createFakeTimer() {
  // 登録済みコールバック群（順に発火する）
  const callbacks: Array<{ id: number; cb: () => void; ms: number }> = [];
  // 単純な連番 ID
  let nextId = 1;
  // タイマー実装本体
  const timer: BatcherTimer = {
    // set でコールバックを登録（実際には発火しない）
    set: (cb, ms) => {
      const id = nextId++;
      callbacks.push({ id, cb, ms });
      return id;
    },
    // clear で登録解除
    clear: (handle) => {
      const idx = callbacks.findIndex((c) => c.id === handle);
      if (idx >= 0) {
        callbacks.splice(idx, 1);
      }
    },
  };
  // 登録されたコールバックを手動で全て発火する
  const runAll = () => {
    // コピーを取りつつ消費（発火中に新規 set されたものは次回に持ち越す）
    const fired = callbacks.splice(0, callbacks.length);
    fired.forEach((c) => c.cb());
  };
  // 現状の登録数
  const pending = () => callbacks.length;
  // タイマー本体と操作 API を返す
  return { timer, runAll, pending };
}

describe("createBatcher", () => {
  // flushSize 未満では onFlush を呼ばない
  it("flushSize 未満では onFlush を呼ばない", () => {
    // 呼び出しを記録するモック
    const onFlush = vi.fn();
    // バッチ機構を生成
    const b = createBatcher<number>({ flushSize: 3, onFlush });
    // 2 件 push
    b.push(1);
    b.push(2);
    // 未到達なので呼ばれない
    expect(onFlush).not.toHaveBeenCalled();
    // size も 2
    expect(b.size()).toBe(2);
  });

  // flushSize 到達で即フラッシュ
  it("flushSize 到達で onFlush(items) が呼ばれバッファが空になる", async () => {
    // 呼び出しを記録
    const onFlush = vi.fn();
    // 機構生成（タイマー未設定）
    const b = createBatcher<number>({ flushSize: 2, onFlush });
    // 1 件 push（未到達）
    b.push(10);
    // 2 件目で到達
    b.push(20);
    // マイクロタスクキューを 1 サイクル消費して非同期 push 内の処理を待つ
    await Promise.resolve();
    // items が現在バッファ内容
    expect(onFlush).toHaveBeenCalledWith([10, 20]);
    // バッファが空に戻っている
    expect(b.size()).toBe(0);
  });

  // インターバル発火で onFlush
  it("flushIntervalMs 経過で onFlush", async () => {
    // フェイクタイマーを構築
    const fake = createFakeTimer();
    // 呼び出し記録
    const onFlush = vi.fn();
    // インターバルを設定
    const b = createBatcher<number>({
      flushSize: 100,
      flushIntervalMs: 50,
      onFlush,
      timer: fake.timer,
    });
    // 1 件 push（タイマーが起動）
    b.push(1);
    // タイマー発火前は未呼び出し
    expect(onFlush).not.toHaveBeenCalled();
    // タイマー手動発火
    fake.runAll();
    // 非同期 onFlush の待機
    await Promise.resolve();
    // items が渡される
    expect(onFlush).toHaveBeenCalledWith([1]);
  });

  // 二重起動防止: push で既にタイマー起動中なら新規 set しない
  it("インターバル起動中は二重に set されない", () => {
    // フェイクタイマー
    const fake = createFakeTimer();
    // バッチ機構
    const b = createBatcher<number>({
      flushSize: 100,
      flushIntervalMs: 50,
      onFlush: () => {},
      timer: fake.timer,
    });
    // 1 件 push
    b.push(1);
    // この時点で 1 つだけタイマー登録されているはず
    expect(fake.pending()).toBe(1);
    // 追加で push
    b.push(2);
    // 依然 1 つだけ（二重起動なし）
    expect(fake.pending()).toBe(1);
  });

  // 明示 flush で空でも例外を出さない
  it("空状態で flush() しても何もしない", async () => {
    // 呼び出し記録
    const onFlush = vi.fn();
    // バッチ機構
    const b = createBatcher<number>({ flushSize: 10, onFlush });
    // 何もせずに flush
    await b.flush();
    // onFlush は呼ばれていない
    expect(onFlush).not.toHaveBeenCalled();
  });

  // flush 経由でも内容が onFlush に流れる
  it("flush() で残バッファを onFlush に流す", async () => {
    // 呼び出し記録
    const onFlush = vi.fn();
    // バッチ機構
    const b = createBatcher<number>({ flushSize: 100, onFlush });
    // 2 件 push（閾値未満）
    b.push(1);
    b.push(2);
    // 明示 flush
    await b.flush();
    // items が流れる
    expect(onFlush).toHaveBeenCalledWith([1, 2]);
    // 二度呼び出されない
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  // dispose でタイマー停止 + 残バッファ flush
  it("dispose() でタイマー停止と残バッファの flush が実行される", async () => {
    // フェイクタイマー
    const fake = createFakeTimer();
    // 呼び出し記録
    const onFlush = vi.fn();
    // バッチ機構
    const b = createBatcher<number>({
      flushSize: 100,
      flushIntervalMs: 50,
      onFlush,
      timer: fake.timer,
    });
    // 1 件 push（タイマー起動）
    b.push(1);
    // タイマー 1 つ登録済み
    expect(fake.pending()).toBe(1);
    // dispose 実行
    await b.dispose();
    // タイマーが解除されている
    expect(fake.pending()).toBe(0);
    // バッファも空になっている
    expect(b.size()).toBe(0);
    // 残バッファが onFlush に流れた
    expect(onFlush).toHaveBeenCalledWith([1]);
  });

  // onFlush の reject 後でも例外を伝播
  it("onFlush が reject すると flush() が reject する", async () => {
    // 失敗する onFlush
    const onFlush = vi.fn(() => Promise.reject(new Error("boom")));
    // バッチ機構
    const b = createBatcher<number>({ flushSize: 100, onFlush });
    // 1 件追加
    b.push(1);
    // flush 結果が reject する
    await expect(b.flush()).rejects.toThrow("boom");
  });

  // onFlush 失敗時に items が buffer 先頭に戻る（次回 flush で復活）
  it("onFlush が reject すると items が buffer 先頭に戻り、次回 flush で復活する", async () => {
    // 最初の onFlush は失敗、2 回目は成功
    let calls = 0;
    const onFlush = vi.fn(async (_items: readonly number[]) => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
    });
    const b = createBatcher<number>({ flushSize: 100, onFlush });
    b.push(1);
    b.push(2);
    // 1 回目 flush は reject
    await expect(b.flush()).rejects.toThrow("transient");
    // size が復元されている
    expect(b.size()).toBe(2);
    // さらに push しても buffer 先頭は失った items が並ぶ
    b.push(3);
    // 2 回目 flush は成功し、3 件揃って渡る
    await b.flush();
    expect(onFlush).toHaveBeenLastCalledWith([1, 2, 3]);
  });

  // タイマー注入なし（DEFAULT_TIMER = setTimeout/clearTimeout）でも動く
  it("timer 未注入でも flushIntervalMs と dispose の clear が動く", async () => {
    // 呼び出し記録
    const onFlush = vi.fn();
    // タイマー未注入で短いインターバル
    const b = createBatcher<number>({ flushSize: 100, flushIntervalMs: 5, onFlush });
    // 1 件 push してインターバルを起動
    b.push(1);
    // タイマーが発火するまで実時間で待機
    await new Promise((r) => setTimeout(r, 30));
    // onFlush が呼ばれた
    expect(onFlush).toHaveBeenCalledWith([1]);
    // 続けてもう一度 push してから dispose（clearTimeout を踏ませる）
    b.push(2);
    await b.dispose();
    // dispose 経由で 2 件目も onFlush に流れた
    expect(onFlush).toHaveBeenCalledWith([2]);
  });
});
