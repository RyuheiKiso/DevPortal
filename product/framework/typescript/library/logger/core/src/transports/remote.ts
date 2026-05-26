// 型を取り込み
import type { LogEntry, Transport } from "../types.js";
// バッファ機構を取り込み
import { createBatcher, type BatcherTimer } from "../batcher.js";

// RemoteTransport の生成オプション
export interface RemoteTransportOptions {
  // 送信先 URL
  endpoint: string;
  // fetch 実装の差し替え（既定: globalThis.fetch）
  fetchImpl?: typeof fetch;
  // 追加 HTTP ヘッダ
  headers?: Record<string, string>;
  // バッチサイズ（既定: 20）
  flushSize?: number;
  // インターバル発火（ms、既定: 5000）
  flushIntervalMs?: number;
  // リトライ回数の上限（既定: 3）
  maxRetries?: number;
  // 指数バックオフの初期遅延（ms、既定: 500）
  backoffBaseMs?: number;
  // ジッタ用の乱数生成（既定: Math.random）
  random?: () => number;
  // リトライ可否の判定関数（既定: 5xx またはネットワークエラーは再試行）
  shouldRetry?: (response: Response | undefined, error: unknown, attempt: number) => boolean;
  // 送信ペイロードの整形（既定: {entries: [...]} の JSON 文字列）
  serialize?: (entries: readonly LogEntry[]) => BodyInit;
  // タイマー実装の差し替え（既定: グローバル setTimeout/clearTimeout）
  timer?: BatcherTimer;
  // 永続失敗 (shouldRetry が false を返したケース) で items を破棄する直前に通知する
  // 旧実装は永続失敗時も items を batcher にリバッファし、4xx 等で「同じバッチを無限再送 → 全件失敗」
  // のループが起きていた。本オプションで観測可能性を担保しつつ、items はそのまま破棄する。
  onPermanentFailure?: (error: unknown, items: readonly LogEntry[]) => void;
}

// 既定ヘッダ（Content-Type を明示）
const DEFAULT_HEADERS: Record<string, string> = {
  // JSON ボディを送るための Content-Type
  "Content-Type": "application/json",
};

// 既定のリトライ判定（fetch が throw、または 5xx ステータスなら再試行）
const defaultShouldRetry = (response: Response | undefined, _error: unknown, _attempt: number): boolean => {
  // ネットワーク等で response が無いケースはリトライ
  if (response === undefined) {
    return true;
  }
  // 5xx はリトライ、それ以外（2xx/3xx/4xx）はリトライしない
  return response.status >= 500 && response.status < 600;
};

// 既定の serialize（entries を JSON 文字列化）
const defaultSerialize = (entries: readonly LogEntry[]): BodyInit =>
  // 単純なラッパーオブジェクトに包んで送信
  JSON.stringify({ entries });

// 永続失敗を示す内部エラー型
// shouldRetry が false を返したケースで sendBatch が throw する。
// onFlush 側でこの型を検出し「items を batcher に戻さず破棄する」分岐に振る。
class RemotePermanentFailure extends Error {
  // 元の原因 (4xx Response や fetch 由来 TypeError 等)
  readonly cause: unknown;
  constructor(cause: unknown) {
    // メッセージは原因に従う (Error なら message、それ以外は String 化)
    // (sendBatch 側は必ず Error を渡すが、API 形上 unknown を受けるため防御的に分岐する)
    /* v8 ignore next */
    super(cause instanceof Error ? cause.message : String(cause));
    // 型判別子 (instanceof と name 比較の双方で識別可能にする)
    this.name = "RemotePermanentFailure";
    // 原因を保持
    this.cause = cause;
  }
}

// HTTP リトライ送信付きのトランスポートを生成
export function createRemoteTransport(opts: RemoteTransportOptions): Transport {
  // 各オプションを既定値で確定
  const flushSize = opts.flushSize ?? 20;
  // インターバル発火（ms）
  const flushIntervalMs = opts.flushIntervalMs ?? 5000;
  // リトライ上限
  const maxRetries = opts.maxRetries ?? 3;
  // バックオフ初期遅延
  const backoffBaseMs = opts.backoffBaseMs ?? 500;
  // ジッタ乱数（既定: Math.random）
  const random = opts.random ?? Math.random;
  // リトライ判定関数（既定: ネットワーク or 5xx）
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
  // ペイロード整形（既定: JSON）
  const serialize = opts.serialize ?? defaultSerialize;
  // ヘッダの合成
  const headers = { ...DEFAULT_HEADERS, ...(opts.headers ?? {}) };
  // fetch 実装（注入優先、無ければグローバル fetch）
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  // 待機用タイマー（バッファ機構と同じ実装を共有）
  const timer: BatcherTimer = opts.timer ?? {
    // setTimeout を呼ぶ
    set: (cb, ms) => setTimeout(cb, ms),
    // ハンドル解除
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };

  // dispose が呼ばれたかどうかを示すフラグ。リトライループや wait の早期終了に使う
  let disposed = false;
  // 進行中の wait を解除するための待機解除関数の集合（dispose 時にまとめて呼ぶ）
  const pendingWaitAborts = new Set<() => void>();
  // 同時送信を防ぐためのフラグ（in-flight ガード）
  let sending: Promise<void> | null = null;

  // バックオフ用に Promise ベースで待機する（dispose 時は aborted=true で即時 resolve）
  const wait = (ms: number): Promise<{ aborted: boolean }> =>
    new Promise<{ aborted: boolean }>((resolve) => {
      // タイマーハンドル（注入された timer.set の戻り値）
      let handle: unknown = null;
      // 解除ロジックを 1 度だけ実行するためのフラグ
      let settled = false;
      // 通常完了用（時間経過で発火、abort されたわけではない）
      const finishNormal = (): void => {
        // 二重実行防止（タイマー二重発火に対する保険、通常ルートでは到達しない）
        /* v8 ignore next */
        if (settled) return;
        settled = true;
        // タイマーが残っていれば停止
        if (handle !== null) {
          timer.clear(handle);
          handle = null;
        }
        // 集合から自分を外す
        pendingWaitAborts.delete(abort);
        // 通常完了として resolve
        resolve({ aborted: false });
      };
      // 中断完了用（dispose 経由で発火）
      const abort = (): void => {
        // 二重実行防止（dispose 二重呼びに対する保険、通常ルートでは到達しない）
        /* v8 ignore next */
        if (settled) return;
        settled = true;
        if (handle !== null) {
          timer.clear(handle);
          handle = null;
        }
        pendingWaitAborts.delete(abort);
        // 中断として resolve（呼出側は aborted=true でバックオフを諦める）
        resolve({ aborted: true });
      };
      // dispose 時にこの待機を抜けるための関数を集合に登録
      pendingWaitAborts.add(abort);
      // 既に dispose 済みなら即時中断
      if (disposed) {
        abort();
        return;
      }
      // 規定時間後にタイマーで通常完了
      handle = timer.set(finishNormal, ms);
    });

  // バッチをまとめて送信する関数（リトライ込み、dispose 時はリトライ打ち切り）
  const sendBatch = async (items: readonly LogEntry[]): Promise<void> => {
    // ボディを整形
    const body = serialize(items);
    // 試行回数
    let attempt = 0;
    // 直前のエラー（ループ終了時に投げる）
    let lastError: unknown = new Error("remote transport failed");
    // リトライ上限まで繰り返す
    while (attempt <= maxRetries) {
      // 今回の fetch 結果（成功時は Response、失敗時は undefined のまま）
      let response: Response | undefined;
      // 例外（fetch 自体が throw した場合に格納）
      let thrown: unknown = undefined;
      try {
        // fetch 呼び出し（POST、ヘッダ、本文）
        response = await fetchImpl(opts.endpoint, {
          method: "POST",
          headers,
          body,
        });
        // 2xx なら成功として戻る
        if (response.ok) {
          return;
        }
      } catch (err) {
        // ネットワーク等で fetch 自体が throw
        thrown = err;
      }
      // 直前のエラーを保持（失敗時はこれを最後に投げる）
      // thrown が defined ならそれを、無ければ response は必ず存在するのでステータスを文字列化
      lastError = thrown ?? new Error(`remote transport failed with status ${response!.status}`);
      // shouldRetry が false なら「永続失敗」として PermanentFailure を投げる
      // (旧実装は通常 Error として投げており、batcher 側で items が無限リバッファされていた)
      if (!shouldRetry(response, thrown, attempt)) {
        throw new RemotePermanentFailure(lastError);
      }
      // リトライ余地が無ければ抜ける
      if (attempt >= maxRetries) {
        break;
      }
      // 指数バックオフ + ジッタ（[0, 1) の乱数で待ち時間を変動）
      const delay = backoffBaseMs * Math.pow(2, attempt) * (1 + random());
      // 待機（dispose されたら aborted=true で即時抜けてリトライ打ち切り）
      const waitResult = await wait(delay);
      // 中断されたらリトライ打ち切り（lastError を保持したまま抜ける）
      if (waitResult.aborted) {
        break;
      }
      // 試行回数を 1 進める
      attempt += 1;
    }
    // リトライ上限到達 or 中断。最後のエラーを投げて呼出側に通知
    throw lastError;
  };

  // 永続失敗通知コールバック (任意)
  const onPermanentFailure = opts.onPermanentFailure;

  // バッチ機構（onFlush で実際に送信する）
  const batcher = createBatcher<LogEntry>({
    // flushSize と flushIntervalMs を伝播
    flushSize,
    flushIntervalMs,
    timer,
    // バッファが満ちる or インターバル発火で呼ばれる
    onFlush: async (items) => {
      // sending が残っている間は while で再評価しつつ待機（3+ 並列でも直列化を保証）
      while (sending !== null) {
        await sending;
      }
      // 送信 Promise を確定し、共有変数に保持（finally で sending=null に戻す）
      const promise = sendBatch(items);
      // 失敗時の swallow せずに乗せる（呼出側で await すれば例外を観測できる）
      sending = promise.finally(() => {
        // 送信完了でガードを解除
        sending = null;
      });
      // 呼出側にも結果を返すため await
      try {
        await sending;
      } catch (err) {
        // 永続失敗 (shouldRetry=false) は items を破棄する分岐に振る
        // (throw すると batcher.flushInternal が items をリバッファして無限ループになる)
        if (err instanceof RemotePermanentFailure) {
          // 任意の観測コールバックがあれば通知 (items は引数で渡し、内部参照は破棄する)
          if (onPermanentFailure !== undefined) {
            try {
              onPermanentFailure(err.cause, items);
            } catch {
              // 観測コールバックの例外は呼出側に影響させない
            }
          }
          // throw せずに正常終了 → batcher は items をリバッファしない (= 永久ループ回避)
          return;
        }
        // dispose 中の一時失敗 (リトライ wait の中断で sendBatch が lastError を投げたケース) は
        // batcher にリバッファしても dispose 完了でロスするだけなので、
        // ここで onPermanentFailure に通知して観測可能にしてから破棄する
        if (disposed) {
          // 観測コールバックがあれば通知 (callbackの中で例外が出ても無視)
          if (onPermanentFailure !== undefined) {
            try {
              onPermanentFailure(err, items);
            } catch {
              // 観測コールバックの例外は呼出側に影響させない
            }
          }
          // throw せずに正常終了 → dispose 経路に巻き戻し、サイレントロスを回避
          return;
        }
        // それ以外 (retryable 上限到達 / 一時失敗) は throw して batcher にリバッファさせる
        throw err;
      }
    },
  });

  // Transport 契約を返す
  return {
    // 識別子
    name: "remote",
    // 1 件を蓄積（送信は batcher 経由）
    write(entry) {
      batcher.push(entry);
    },
    // 残バッファ送信に加え、進行中の sending も明示的に await する
    async flush() {
      // batcher の残バッファをまず flush（チェイン経由で新規の sendBatch が走る可能性あり）
      await batcher.flush();
      // batcher.flush 後に進行中の sending があれば最後まで待つ
      while (sending !== null) {
        // 失敗時の例外をここで再投げするのが目的のため try/catch せず await
        await sending;
      }
    },
    // タイマー停止 + バックオフ中断 + 残バッファ送信
    async dispose() {
      // 以降の新規 wait/sendBatch を抑止
      disposed = true;
      // 進行中の wait をすべて即時解除（バックオフを切り上げ）
      for (const abort of Array.from(pendingWaitAborts)) {
        abort();
      }
      // 集合は abort() 内で自身を delete するが念のため空にしておく
      pendingWaitAborts.clear();
      // 残バッファを送信（disposed フラグにより各リトライは即終了）
      // batcher.dispose は内部で flushInternal を呼ぶため、未送信分を一度走らせる。
      // 修正後 onFlush は dispose 中の失敗を `return` 分岐に倒すため batcher.dispose() は reject されない設計。
      await batcher.dispose();
      // 進行中の sending があれば終わるまで待つ（disposed により早期終了するはず）
      while (sending !== null) {
        try {
          await sending;
        } catch {
          // 進行中送信の失敗も dispose では握りつぶす
        }
      }
    },
  };
}
