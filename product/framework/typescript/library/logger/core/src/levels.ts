// LogLevel の型を再利用するために import
import type { LogLevel } from "./types.js";

// ログレベルの順序定義（インデックスがそのまま重要度になる）
export const LOG_LEVELS = [
  // 0: 最低レベル
  "trace",
  // 1: デバッグ
  "debug",
  // 2: 通常
  "info",
  // 3: 警告
  "warn",
  // 4: エラー
  "error",
  // 5: 致命的
  "fatal",
] as const satisfies readonly LogLevel[];

// レベル文字列 → 数値ランクの引き当てテーブル
export const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  // trace は最小ランク
  trace: 0,
  // debug
  debug: 1,
  // info
  info: 2,
  // warn
  warn: 3,
  // error
  error: 4,
  // fatal は最大ランク
  fatal: 5,
};

// 2 つのレベルを比較し、a-b の符号を返す（負: a が小、零: 同等、正: a が大）
export function compareLevel(a: LogLevel, b: LogLevel): number {
  // ランクの差分を素直に返す
  return LEVEL_RANK[a] - LEVEL_RANK[b];
}

// エントリのレベルが最小レベル以上か判定（境界は通す）
export function shouldLog(entryLevel: LogLevel, minLevel: LogLevel): boolean {
  // a の重要度が b 以上ならログを出す
  return LEVEL_RANK[entryLevel] >= LEVEL_RANK[minLevel];
}
