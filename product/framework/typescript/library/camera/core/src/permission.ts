// PermissionStatus 型のみ参照
import type { PermissionStatus } from "./types.js";

// 権限が許可されたかを判定するヘルパ
export function isPermissionGranted(status: PermissionStatus): boolean {
  // granted のみが本当に許可されている状態
  return status === "granted";
}

// 再要求可能（prompt が出せる）かを判定するヘルパ
export function canRequestPermission(status: PermissionStatus): boolean {
  // prompt または denied（blocked と unavailable は再要求不可）
  return status === "prompt" || status === "denied";
}

// 設定アプリ誘導が必要な状態か（blocked のみ）
export function shouldOpenSettings(status: PermissionStatus): boolean {
  // blocked は OS の設定変更が必要
  return status === "blocked";
}
