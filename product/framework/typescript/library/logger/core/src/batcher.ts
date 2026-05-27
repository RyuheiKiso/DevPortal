// テスト容易性のためにタイマー関数を差し替え可能なインターフェースで受け取る
export interface BatcherTimer {
  // setTimeout 相当（任意のハンドル型を返す）
  set: (cb: () => void, ms: number) => unknown;
  // clearTimeout 相当
  clear: (handle: unknown) => void;
}

// createBatcher へ渡すオプション
export interface BatcherOptions<T> {
  // この件数に達したら即フラッシュ
  flushSize: number;
  // 指定時間（ms）経過でフラッシュ（未指定ならインターバル発火しない）
  flushIntervalMs?: number;
  // 連続失敗時の指数バックオフ上限（R7）。既定: flushIntervalMs * 32
  // flushIntervalMs 未指定の場合はバックオフ自体が無効
  maxFlushIntervalMs?: number;
  // フラッシュ実行関数。同期/非同期どちらでも可
  onFlush: (items: readonly T[]) => Promise<void> | void;
  // タイマー実装の差し替え（既定: グローバル setTimeout/clearTimeout）
  timer?: BatcherTimer;
}

// Batcher の公開インターフェース
export interface Batcher<T> {
  // 1 件を蓄積。flushSize 到達で即フラッシュ
  push(item: T): void;
  // 残バッファを明示フラッシュ
  flush(): Promise<void>;
  // タイマー停止 + 残バッファのフラッシュ
  dispose(): Promise<void>;
  // 現在のバッファサイズ
  size(): number;
}

// 既定のタイマー実装（グローバル setTimeout / clearTimeout を直接利用）
const DEFAULT_TIMER: BatcherTimer = {
  // setTimeout を呼び出し、ハンドルを unknown 型で返す
  set: (cb, ms) => setTimeout(cb, ms),
  // ハンドルを setTimeout に与えてクリア
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// バッファとタイマーを持つ汎用バッチ機構を生成
export function createBatcher<T>(opts: BatcherOptions<T>): Batcher<T> {
  // 内部バッファ
  let buffer: T[] = [];
  // 起動中のタイマーハンドル（未起動の間は null）
  let timerHandle: unknown = null;
  // dispose 済みフラグ。dispose() 以降は新しいタイマー起動と push を no-op にする
  // (旧実装はフラグが無く、タイマー駆動経路の `.catch(() => startTimer())` が dispose 完了後に発火して
  //  setTimeout がリークする / dispose 後の push で buffer に積まれる、といったリーク経路があった)
  let disposed = false;
  // 連続失敗カウンタ (R7 指数バックオフで使用)
  let consecutiveFailures = 0;
  // タイマー実装は与えられていればそれを、無ければ既定を使う
  const timer = opts.timer ?? DEFAULT_TIMER;
  // 指数バックオフ上限 (R7)。flushIntervalMs * 32 (= 約 5 段階倍々) を既定とする。
  // flushIntervalMs 未指定の場合はバックオフ自体が呼ばれないので Infinity でも問題ない。
  const maxBackoffMs = opts.maxFlushIntervalMs ?? (opts.flushIntervalMs !== undefined ? opts.flushIntervalMs * 32 : Number.POSITIVE_INFINITY);

  // 現在動いているタイマーを停止する
  const clearTimer = (): void => {
    // ハンドルがある場合のみクリア
    if (timerHandle !== null) {
      // 実装に依頼してハンドルを解除
      timer.clear(timerHandle);
      // ハンドルを未起動状態に戻す
      timerHandle = null;
    }
  };

  // インターバルフラッシュ用のタイマーを起動する
  // intervalOverride を渡すと指定 ms でタイマー登録 (R7 バックオフ用)。無指定なら opts.flushIntervalMs。
  const startTimer = (intervalOverride?: number): void => {
    // dispose 後は新規タイマーを立てない (R2)
    if (disposed) {
      return;
    }
    // 採用するインターバル (override > opts.flushIntervalMs)
    const interval = intervalOverride ?? opts.flushIntervalMs;
    // インターバルが未設定なら何もしない
    if (interval === undefined) {
      return;
    }
    // 既にタイマーが動いていれば二重起動しない
    if (timerHandle !== null) {
      return;
    }
    // タイマーを起動し、ハンドルを保持
    timerHandle = timer.set(() => {
      // 発火時はハンドルをクリアしてから flush
      timerHandle = null;
      // 非同期 flush は await しない（タイマーコールバックでは fire-and-forget）
      // 失敗時は flushInternal が items を buffer に戻したうえで catch される。
      // flushInternal の catch 内で startTimer() を呼ぶ統一設計のため、ここでは握りつぶすだけで OK。
      flushInternal().catch(() => {});
    }, interval);
  };

  // バッファを取り出して onFlush に渡す内部実装
  const flushInternal = async (): Promise<void> => {
    // バッファが空なら何もしない
    if (buffer.length === 0) {
      return;
    }
    // 現在のバッファを抜き取り、即座に空に戻す（flush 中の push を次回に持ち越すため）
    const items = buffer;
    buffer = [];
    // タイマーを停止（フラッシュタイミングがリセットされる）
    clearTimer();
    try {
      // onFlush 呼び出し（同期/非同期どちらでも await で吸収）
      await opts.onFlush(items);
      // 成功で連続失敗カウンタをリセット (R7)
      consecutiveFailures = 0;
    } catch (err) {
      // 失敗時は失った items を buffer の先頭に戻し、データロスを回避
      buffer = [...items, ...buffer];
      // 連続失敗カウンタを更新 (R7)
      consecutiveFailures += 1;
      // 失敗後にもインターバル発火を継続させるためタイマー再起動。disposed なら no-op (R2)。
      // バックオフ: 連続失敗 N 回で interval を 2^N 倍に伸ばす (上限 maxBackoffMs)。
      if (opts.flushIntervalMs !== undefined) {
        const backoff = Math.min(
          opts.flushIntervalMs * Math.pow(2, consecutiveFailures - 1),
          maxBackoffMs,
        );
        startTimer(backoff);
      }
      // 例外は呼出側（明示 flush / dispose）に伝える。タイマー駆動の push 経路では void で握りつぶされるが、items は保持される
      throw err;
    }
  };

  // 公開オブジェクトを返す
  return {
    // push: バッファに追加し、閾値到達でフラッシュ
    push(item) {
      // dispose 後の push は no-op (R2)。利用者が誤って push し続けても buffer はリークしない
      if (disposed) {
        return;
      }
      // バッファに追加
      buffer.push(item);
      // インターバル設定があり、未起動ならタイマーを起動
      startTimer();
      // 閾値に達した場合はその場でフラッシュを開始
      if (buffer.length >= opts.flushSize) {
        // タイマー駆動と同様 fire-and-forget。失敗時は items が buffer に戻されているので握りつぶす
        flushInternal().catch(() => {});
      }
    },
    // flush: 明示的にバッファを処理
    async flush() {
      // 内部 flush に委譲
      await flushInternal();
    },
    // dispose: タイマー停止 + 残バッファを flush
    async dispose() {
      // 以降の startTimer / push を no-op に倒す (R2)
      disposed = true;
      // タイマーを停止
      clearTimer();
      // 残バッファを処理
      await flushInternal();
    },
    // size: 現在のバッファ件数
    size() {
      return buffer.length;
    },
  };
}
