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
  // タイマー実装は与えられていればそれを、無ければ既定を使う
  const timer = opts.timer ?? DEFAULT_TIMER;

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
  const startTimer = (): void => {
    // インターバルが未設定なら何もしない
    if (opts.flushIntervalMs === undefined) {
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
      // タイマー駆動経路は明示 flush と異なり「呼出側が例外を観測する手段がない」ので、
      // ここで startTimer() を呼んで次の発火を再スケジュールし、滞留バグを回避する。
      flushInternal().catch(() => {
        // タイマー駆動経路でだけタイマーを再起動（明示 flush 経路の連鎖発火は引き起こさない）
        startTimer();
      });
    }, opts.flushIntervalMs);
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
    } catch (err) {
      // 失敗時は失った items を buffer の先頭に戻し、データロスを回避
      buffer = [...items, ...buffer];
      // 例外は呼出側（明示 flush / dispose）に伝える。タイマー駆動の push 経路では void で握りつぶされるが、items は保持される
      throw err;
    }
  };

  // 公開オブジェクトを返す
  return {
    // push: バッファに追加し、閾値到達でフラッシュ
    push(item) {
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
