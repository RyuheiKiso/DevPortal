// 公開型を取り込み
import type { AuditEvent, KvStore, StorageScope } from "./types.js";

// withAudit の生成オプション
export interface WithAuditOptions<T> {
  // 監査イベントの送信先 (logger / @k1s0-ts-audit の sink などを想定)
  sink: (event: AuditEvent) => void;
  // set 時の payload を AuditEvent に含めるか / 何を載せるかを決めるコールバック
  // 機密情報 (トークン / PII) を直接 sink に流さないためのフック
  redact?: (key: string, value: T) => unknown;
  // この KvStore のスコープ識別子 (registry が wrap するときに注入)
  scope?: StorageScope;
  // タイムスタンプ取得関数 (テスト固定化のため差し替え可能)
  now?: () => number;
}

// 監査ログを発行するミドルウェアを生成する
// 各操作の成否を逐次 sink へ通知する。例外は sink 通知後に再 throw する
export function withAudit<T>(
  // 生成オプション
  options: WithAuditOptions<T>,
): (inner: KvStore<T>) => KvStore<T> {
  // sink 関数
  const sink = options.sink;
  // redact (省略時は payload を載せない)
  const redact = options.redact;
  // スコープ (省略可)
  const scope = options.scope;
  // 現在時刻関数 (省略時は Date.now)
  const now = options.now ?? (() => Date.now());
  // 共通の発火ヘルパ
  const emit = (
    op: AuditEvent["op"],
    key: string | null,
    ok: boolean,
    error?: unknown,
    payload?: unknown,
  ): void => {
    // 監査イベントを組み立てて sink に渡す
    const event: AuditEvent = {
      // 操作種別
      op,
      // 対象キー
      key,
      // 成否
      ok,
      // タイムスタンプ
      timestamp: now(),
    };
    // 失敗時のみ error を載せる
    if (!ok) event.error = error;
    // scope が設定されていれば載せる
    if (scope !== undefined) event.scope = scope;
    // payload が指定されていれば載せる
    if (payload !== undefined) event.payload = payload;
    // sink に通知
    sink(event);
  };
  // カリー化された wrapper を返す
  return (inner: KvStore<T>): KvStore<T> => {
    // 完成した KvStore を組み立てる
    const wrapped: KvStore<T> = {
      // get: 成功時に op="get" + ok=true、失敗時に ok=false + error
      async get(key: string): Promise<T | undefined> {
        try {
          // 値を取得
          const value = await inner.get(key);
          // 成功イベント
          emit("get", key, true);
          // 値を返す
          return value;
        } catch (e) {
          // 失敗イベント
          emit("get", key, false, e);
          // 例外は上位へ
          throw e;
        }
      },
      // set: 成功時に op="set" + redact 適用 payload、失敗時に ok=false + error
      async set(key: string, value: T): Promise<void> {
        // redact を適用した payload (redact 未指定なら undefined → AuditEvent に含めない)
        const payload = redact !== undefined ? redact(key, value) : undefined;
        try {
          // 保存
          await inner.set(key, value);
          // 成功イベント
          emit("set", key, true, undefined, payload);
        } catch (e) {
          // 失敗イベント (payload は redact 適用済みでも安全に載せる)
          emit("set", key, false, e, payload);
          // 例外は上位へ
          throw e;
        }
      },
      // remove
      async remove(key: string): Promise<void> {
        try {
          // 削除
          await inner.remove(key);
          // 成功イベント
          emit("remove", key, true);
        } catch (e) {
          // 失敗イベント
          emit("remove", key, false, e);
          // 例外は上位へ
          throw e;
        }
      },
    };
    // has / keys / subscribe は監査対象外 (副作用が無いため)、素通し
    if (inner.has !== undefined) {
      const innerHas = inner.has;
      wrapped.has = async (key: string): Promise<boolean> => innerHas(key);
    }
    if (inner.keys !== undefined) {
      const innerKeys = inner.keys;
      wrapped.keys = async (): Promise<readonly string[]> => innerKeys();
    }
    if (inner.subscribe !== undefined) {
      const innerSubscribe = inner.subscribe;
      wrapped.subscribe = (listener): () => void => innerSubscribe(listener);
    }
    // clear は副作用が大きいので監査対象
    if (inner.clear !== undefined) {
      const innerClear = inner.clear;
      wrapped.clear = async (): Promise<void> => {
        try {
          // クリア実行
          await innerClear();
          // 成功イベント (key は null)
          emit("clear", null, true);
        } catch (e) {
          // 失敗イベント
          emit("clear", null, false, e);
          // 例外は上位へ
          throw e;
        }
      };
    }
    // 完成した KvStore を返す
    return wrapped;
  };
}
