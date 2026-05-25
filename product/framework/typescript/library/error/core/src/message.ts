// 公開型を取り込み
import type { AppErrorKind, AppErrorSeverity } from "./types.js";

// kind ごとの既定ユーザー向けメッセージ（ユーザーへ提示する 1 文）
const DEFAULT_MESSAGES: Readonly<Record<AppErrorKind, string>> = {
  // ネットワーク到達不可
  network: "Network communication failed. Please check your connection.",
  // 応答待ちが規定時間を超えた
  timeout: "The request timed out. Please try again.",
  // 一般的な HTTP 失敗
  http: "The request failed.",
  // 認証失効・未ログイン
  auth: "Please sign in again.",
  // 認可なし
  permission: "You do not have permission to perform this operation.",
  // 入力値の検証失敗
  validation: "Please check the entered values.",
  // 業務ルール起因の失敗
  business: "The operation could not be completed.",
  // 同時更新による競合
  conflict: "The data was updated by another operation. Please reload and try again.",
  // リソース未検出
  notFound: "The requested data was not found.",
  // システム/サーバー側の致命的失敗
  system: "A system error occurred. Please contact support if the problem continues.",
  // 分類不能の予期しないエラー
  unknown: "An unexpected error occurred.",
};

// kind に対応する既定ユーザーメッセージを返す
export function defaultUserMessage(kind: AppErrorKind): string {
  return DEFAULT_MESSAGES[kind];
}

// kind に対応する既定 severity を返す
// system / unknown は critical、ユーザー修正可能な validation 系は warning、それ以外は error
export function defaultSeverity(kind: AppErrorKind): AppErrorSeverity {
  // システム障害・分類不能は最高重要度
  if (kind === "system" || kind === "unknown") {
    return "critical";
  }
  // ユーザー側で修正可能な分類は警告レベル
  if (kind === "validation" || kind === "business" || kind === "conflict" || kind === "notFound") {
    return "warning";
  }
  // 通信・認証・認可・HTTP 一般はエラーレベル
  return "error";
}

/**
 * kind の既定の再試行可否を返す。
 *
 * - network / timeout / conflict は常に再試行可能（楽観ロック / バージョン衝突の自動再試行を許可する設計）。
 * - status が渡された場合は HTTP セマンティクスで上書き判定:
 *   - 408 (Timeout), 409 (Conflict), 429 (Too Many Requests), 500 以上 は再試行可能。
 * - それ以外（business / validation / auth / permission / notFound 等）は kind 単独では再試行しない。
 *   ただし status が来ていれば HTTP セマンティクスで再試行可能と判定されることがある。
 */
export function defaultRetryable(kind: AppErrorKind, status?: number): boolean {
  // 通信失敗・タイムアウト・競合は kind 単独で再試行可能（楽観ロック想定）
  if (kind === "network" || kind === "timeout" || kind === "conflict") {
    return true;
  }
  // HTTP status が来ていれば HTTP セマンティクスを優先
  if (typeof status === "number") {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  // それ以外（business / validation / auth など）は kind 単独では再試行しない
  return false;
}

// kind に対応する既定 reportable（監視通報の対象か）を返す
// 業務・検証・認可・認証エラーはユーザー側の問題のため通報対象から外す
export function defaultReportable(kind: AppErrorKind): boolean {
  return kind === "system" || kind === "unknown" || kind === "http" || kind === "network" || kind === "timeout";
}
