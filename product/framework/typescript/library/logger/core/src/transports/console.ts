// 型をパッケージ内から取り込み
import type { LogEntry, Transport } from "../types.js";

// console 互換の最小インターフェース（テストで差し替えるため）
export interface ConsoleLike {
  // デバッグ系
  debug: (...args: unknown[]) => void;
  // 情報
  info: (...args: unknown[]) => void;
  // 警告
  warn: (...args: unknown[]) => void;
  // エラー
  error: (...args: unknown[]) => void;
  // 汎用 log（このトランスポートでは現在未使用だが API 互換のため受け取る）
  log: (...args: unknown[]) => void;
}

// ConsoleTransport の生成オプション
export interface ConsoleTransportOptions {
  // 注入する console 実装（既定: グローバル console）
  console?: ConsoleLike;
  // ログを整形して引数配列にする関数（既定: entry 単体を渡す）
  format?: (entry: LogEntry) => unknown[];
}

// console 互換オブジェクトに出力するトランスポートを生成
export function createConsoleTransport(opts: ConsoleTransportOptions = {}): Transport {
  // 注入された console、無ければグローバル console を使う
  const con = opts.console ?? (globalThis.console as ConsoleLike);
  // 整形関数、無ければエントリそのものを単一引数で渡す
  const format = opts.format ?? ((entry: LogEntry) => [entry]);

  // Transport 契約に合うオブジェクトを返す
  return {
    // 識別用の名前
    name: "console",
    // 1 件を出力。レベルに応じて console のメソッドを振り分ける
    write(entry) {
      // 整形した引数列
      const args = format(entry);
      // レベルごとのディスパッチ
      switch (entry.level) {
        // trace / debug は console.debug へ
        case "trace":
        case "debug":
          con.debug(...args);
          return;
        // info は console.info へ
        case "info":
          con.info(...args);
          return;
        // warn は console.warn へ
        case "warn":
          con.warn(...args);
          return;
        // error / fatal は console.error へ
        case "error":
        case "fatal":
          con.error(...args);
          return;
      }
    },
  };
}
