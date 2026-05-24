// 必要な型を取り込み
import type { Env, EnvLogLevelMap, LogEntry, LogLevel } from "./types.js";
// 最小レベル判定用のユーティリティを取り込み
import { shouldLog } from "./levels.js";

// 既定の最小ログレベル（envLevels と defaultMinLevel がどちらも未指定の場合に使う）
const FALLBACK_MIN_LEVEL: LogLevel = "info";

// env から最小ログレベルを解決する
export function resolveMinLevel(
  // 現在の実行環境
  env: Env,
  // 環境ごとの最小レベル指定
  envLevels?: EnvLogLevelMap,
  // env が envLevels に無いときのフォールバック
  fallback?: LogLevel,
): LogLevel {
  // envLevels で当該 env が定義されていればそれを返す
  const explicit = envLevels?.[env];
  // 明示指定があれば優先
  if (explicit !== undefined) {
    return explicit;
  }
  // fallback の引数が与えられていればそれ、無ければハードコード既定
  return fallback ?? FALLBACK_MIN_LEVEL;
}

// 環境別フィルタ生成用の引数
export interface CreateLevelFilterArgs {
  // 実行環境
  env: Env;
  // 環境ごとの最小レベル
  envLevels?: EnvLogLevelMap;
  // env 未マッチ時の既定最小レベル
  defaultMinLevel?: LogLevel;
}

// 「このエントリを通すか」を判定する predicate を返す高階関数
export function createLevelFilter(args: CreateLevelFilterArgs): (entry: LogEntry) => boolean {
  // 一度解決した最小レベルをクロージャに保持
  const minLevel = resolveMinLevel(args.env, args.envLevels, args.defaultMinLevel);
  // エントリのレベルが minLevel 以上なら true
  return (entry) => shouldLog(entry.level, minLevel);
}
