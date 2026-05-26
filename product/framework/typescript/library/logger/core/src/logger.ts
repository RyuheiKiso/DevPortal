// 型と契約を取り込み
import type {
  LogData,
  LogEntry,
  Logger,
  LoggerBindings,
  LoggerConfig,
  LogLevel,
  Transport,
} from "./types.js";
// レベルフィルタを取り込み
import { createLevelFilter } from "./filter.js";

// 任意の値が Error 互換のプロパティを持つかを判定（cross-realm Error への duck-typing）
function looksLikeError(value: unknown): value is { name?: unknown; message?: unknown; stack?: unknown } {
  // null/undefined や object 以外は除外
  if (value === null || typeof value !== "object") {
    return false;
  }
  // message を持つオブジェクトを Error 互換とみなす
  return "message" in value;
}

// 任意の値を LogEntry.error 形式に正規化（Error / Error 互換 / プレーンオブジェクト / プリミティブを区別して扱う）
function normalizeError(value: unknown): LogEntry["error"] {
  // null / undefined はメッセージのみのエラーとして扱う（呼出側のミスを明示）
  if (value === null || value === undefined) {
    return { name: "Error", message: String(value) };
  }
  // 真の Error クラスのインスタンスなら name/message/stack をそのまま抽出
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  // Symbol は String() が throw するため toString を try で囲んで安全に文字列化
  if (typeof value === "symbol") {
    // 大半の実装で動くが念のため例外捕捉
    try {
      return { name: "Error", message: value.toString() };
    } catch {
      // toString も失敗した場合は固定文字列
      return { name: "Error", message: "[symbol]" };
    }
  }
  // Cross-realm の Error（worker_threads / iframe など）。instanceof は失敗するが name/message を持っていれば抽出
  if (looksLikeError(value)) {
    // name は欠落する場合があるので既定 "Error"
    const name = typeof value.name === "string" ? value.name : "Error";
    // message は文字列化（toString を使わず String で安定化）
    const message = typeof value.message === "string" ? value.message : String(value.message);
    // stack は存在すれば抽出
    const stack = typeof value.stack === "string" ? value.stack : undefined;
    // Error 互換の正規化結果
    return { name, message, stack };
  }
  // 残りのプレーンオブジェクトは JSON.stringify で詳細を保持（循環参照は try で握りつぶし String にフォールバック）
  if (typeof value === "object") {
    // JSON 化を試みる
    try {
      // 配列・プレーンオブジェクト共に詳細を文字列化
      return { name: "Error", message: JSON.stringify(value) };
    } catch {
      // 循環参照などで失敗したら String にフォールバック
      return { name: "Error", message: Object.prototype.toString.call(value) };
    }
  }
  // 残るのはプリミティブ（string/number/boolean/bigint/function）→ String で安全に変換
  return { name: "Error", message: String(value) };
}

// 親バインディングと子バインディングを合成（タグは結合のうえ重複除去、context は浅マージ）
function mergeBindings(parent: LoggerBindings, child: LoggerBindings): LoggerBindings {
  // 結合後のタグ配列（両者がある場合のみ、Set で重複除去）
  const tags = parent.tags || child.tags
    ? Array.from(new Set([...(parent.tags ?? []), ...(child.tags ?? [])]))
    : undefined;
  // 結合後のコンテキスト（両者がある場合のみ）
  const context = parent.context || child.context
    ? { ...(parent.context ?? {}), ...(child.context ?? {}) }
    : undefined;
  // 統合結果
  return { tags, context };
}

// pendingWrites: 進行中の safeWrite Promise を保持し、flush/dispose 時に追従させる
type PendingSet = Set<Promise<void>>;

// 1 つの Transport.write の例外を握りつぶし、onTransportError へ通知するラッパ
// 返り値の Promise を pendingWrites に登録し、完了時に自動で外す
function safeWrite(
  transport: Transport,
  entry: LogEntry,
  pending: PendingSet,
  onError?: LoggerConfig["onTransportError"],
): void {
  // 非同期処理を IIFE で作って Promise を取得
  const p = (async () => {
    // write は同期/非同期どちらでも返るため await で吸収
    try {
      await transport.write(entry);
    } catch (err) {
      // onTransportError が設定されていれば通知（無ければ握りつぶす）
      onError?.(transport, entry, err);
    }
  })();
  // 完了時に集合から除去するための tracked Promise を作る
  // 旧実装は `pending.add(p)` の後で `p.finally(...)` の戻り値を捨てており、
  // flush() の `Promise.allSettled(Array.from(pending))` が finally の処理を確実に待てなかった。
  // tracked を集合に登録することで「write 完了 + 削除」までを 1 つの Promise として追跡する。
  const tracked: Promise<void> = p.finally(() => {
    pending.delete(tracked);
  });
  // 進行中 Promise を集合に登録 (削除は上の finally 内で行う)
  pending.add(tracked);
}

// transport.flush または dispose を呼ぶラッパ
// 例外は onTransportError に通知しつつ、Promise としても reject する（呼出側で AggregateError 集約に使う）
async function callLifecycle(
  transport: Transport,
  method: "flush" | "dispose",
  onError?: LoggerConfig["onTransportError"],
): Promise<void> {
  // 対象メソッドが未実装の transport はスキップ（成功扱い）
  const fn = transport[method];
  // 未定義ならスキップ
  if (fn === undefined) {
    return;
  }
  try {
    // 関数を transport コンテキストで呼ぶ
    await fn.call(transport);
  } catch (err) {
    // 例外は通知（エントリは関係しないので null）
    onError?.(transport, null, err);
    // 呼出側に集約させるため例外を再送出
    throw err;
  }
}

// allSettled の結果から rejected を集める。1 件以上あれば AggregateError を投げる
function throwIfAnyRejected(results: PromiseSettledResult<void>[], stage: "flush" | "dispose"): void {
  // rejected の reason だけを抜き出す
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason);
  // 1 件以上失敗があれば AggregateError として伝播
  if (errors.length > 0) {
    throw new AggregateError(errors, `logger.${stage} failed for ${errors.length} transport(s)`);
  }
}

// 設定から Logger を生成
export function createLogger(config: LoggerConfig): Logger {
  // レベルフィルタを構築
  const passes = createLevelFilter({
    env: config.env,
    envLevels: config.envLevels,
    defaultMinLevel: config.defaultMinLevel,
  });
  // 時刻取得関数（注入無ければ Date.now）
  const now = config.now ?? Date.now;
  // 全エントリに付与するバインディング（config から派生）
  const rootBindings: LoggerBindings = {
    tags: config.tags,
    context: config.context,
  };
  // 進行中 write の Promise 集合（root 共有）
  const pendingWrites: PendingSet = new Set();

  // 与えられたバインディングで Logger を構築する内部関数（isRoot で root と child を区別）
  const build = (bindings: LoggerBindings, isRoot: boolean): Logger => {
    // 単一エントリを組み立てて transports へ流す
    const emit = (level: LogLevel, message: string, data?: LogData): void => {
      // 仮エントリ（フィルタ判定用に最低限のフィールドを揃える）
      const draftEntry: LogEntry = { level, message, timestamp: now() };
      // フィルタを通過しない場合は何もせず終了
      if (!passes(draftEntry)) {
        return;
      }
      // data から error フィールドだけ抜き出して残りを meta にする
      let meta: Record<string, unknown> | undefined;
      // 正規化済みのエラーオブジェクト
      let errorField: LogEntry["error"] | undefined;
      // data が与えられている場合のみ抽出
      if (data !== undefined) {
        // 分解（error は別フィールド、それ以外は meta に格納）
        const { error: rawError, ...rest } = data;
        // error 指定があれば正規化
        if (rawError !== undefined) {
          errorField = normalizeError(rawError);
        }
        // 残キーが 1 つ以上あれば meta に詰める
        if (Object.keys(rest).length > 0) {
          meta = rest;
        }
      }
      // 完成エントリ（タグ・コンテキストはバインディングから付与）
      const entry: LogEntry = {
        level,
        message,
        timestamp: draftEntry.timestamp,
        tags: bindings.tags,
        context: bindings.context,
        meta,
        error: errorField,
      };
      // 全 transports に並行で書き出し、ハンドラ経由で例外を吸収。Promise は pendingWrites で追跡
      for (const transport of config.transports) {
        safeWrite(transport, entry, pendingWrites, config.onTransportError);
      }
    };

    // Logger 公開オブジェクト
    return {
      // 各レベルメソッドは emit に level を埋めて委譲
      trace: (message, data) => emit("trace", message, data),
      debug: (message, data) => emit("debug", message, data),
      info: (message, data) => emit("info", message, data),
      warn: (message, data) => emit("warn", message, data),
      error: (message, data) => emit("error", message, data),
      fatal: (message, data) => emit("fatal", message, data),
      // child: 現在のバインディングに追加分をマージした派生 logger を返す（child は isRoot=false）
      child(extra) {
        return build(mergeBindings(bindings, extra), false);
      },
      // flush: 進行中 write を待ったあと、全 transports の flush を呼ぶ。失敗があれば AggregateError
      // child の flush は no-op（README/TSDoc 参照）
      async flush() {
        // root のみが flush を実行する
        if (!isRoot) {
          return;
        }
        // 進行中 write のスナップショットを取り、それらが終わるまで待機
        await Promise.allSettled(Array.from(pendingWrites));
        // 各 transport の flush 呼び出し
        const results = await Promise.allSettled(
          config.transports.map((t) => callLifecycle(t, "flush", config.onTransportError)),
        );
        // 失敗があれば集約してスロー
        throwIfAnyRejected(results, "flush");
      },
      // dispose: 進行中 write を待ったあと、全 transports の dispose を呼ぶ。失敗があれば AggregateError
      // child の dispose は no-op
      async dispose() {
        // root のみが dispose を実行する
        if (!isRoot) {
          return;
        }
        // 進行中 write を待機
        await Promise.allSettled(Array.from(pendingWrites));
        // 各 transport の dispose 呼び出し
        const results = await Promise.allSettled(
          config.transports.map((t) => callLifecycle(t, "dispose", config.onTransportError)),
        );
        // 失敗があれば集約してスロー
        throwIfAnyRejected(results, "dispose");
      },
    };
  };

  // ルート bindings で Logger を構築して返す（isRoot=true）
  return build(rootBindings, true);
}
