// 通知レベルの型を取り込み
import type { NotificationLevel } from "./types.js";

// 通知レベルの順序定義（インデックスがそのまま重要度になる）
export const NOTIFICATION_LEVELS = [
  // 0: 情報
  "info",
  // 1: 成功
  "success",
  // 2: 警告
  "warning",
  // 3: エラー
  "error",
] as const satisfies readonly NotificationLevel[];

// レベル文字列 → 数値ランクの引き当てテーブル
export const LEVEL_RANK: Readonly<Record<NotificationLevel, number>> = {
  // info は最小ランク
  info: 0,
  // success
  success: 1,
  // warning
  warning: 2,
  // error は最大ランク
  error: 3,
};

// 2 つのレベルを比較し、a-b の符号を返す（負: a が小、零: 同等、正: a が大）
export function compareLevel(a: NotificationLevel, b: NotificationLevel): number {
  // ランクの差分を素直に返す
  return LEVEL_RANK[a] - LEVEL_RANK[b];
}

// a のほうが b より高い重要度かどうかを判定
export function isHigherLevel(a: NotificationLevel, b: NotificationLevel): boolean {
  // a > b ならば真
  return LEVEL_RANK[a] > LEVEL_RANK[b];
}
