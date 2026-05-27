// PermissionDescriptor は権限関連エラーで構造的に参照される
import type { PermissionDescriptor } from "./types.js";

// CameraError の共通フィールドを抽出した抽象基底
// instanceof 判定で type predicate に使うため export する（runAdapter 内の duck typing を厳密化する用途）
export abstract class BaseCameraError extends Error {
  // ドメイン固有のエラーコード（"PERMISSION_DENIED" など）
  abstract readonly code: string;
  // 再試行可能フラグ（UI で再実行ボタンを出す判断材料）
  abstract readonly retryable: boolean;
  // ベース constructor は Error.message のみ転送
  constructor(message: string, options?: { cause?: unknown }) {
    // Error 基底へメッセージと cause を委譲
    super(message, options);
    // V8 系の stack 表記を整える
    this.name = new.target.name;
  }
}

// 汎用カメラエラー（その他に分類されないケース）
export class CameraError extends BaseCameraError {
  // 既定の code（"CAMERA_ERROR" 等の任意文字列で上書き可）
  readonly code: string;
  // retryable は呼出側が決める
  readonly retryable: boolean;
  // constructor は code / retryable を任意で受け取る
  constructor(message: string, options?: { code?: string; retryable?: boolean; cause?: unknown }) {
    // 基底に message と cause を渡す
    super(message, { cause: options?.cause });
    // 未指定なら汎用 code を割り当て
    this.code = options?.code ?? "CAMERA_ERROR";
    // 未指定なら false（保守的に再試行不可）
    this.retryable = options?.retryable ?? false;
  }
}

// プレビュー未開始時に撮影／録画／スキャンが呼ばれたときのエラー
export class CameraNotReadyError extends BaseCameraError {
  // 固定 code
  readonly code = "CAMERA_NOT_READY" as const;
  // プレビュー再開始で復帰可能なので retryable true
  readonly retryable = true;
  // constructor は message を任意で受け取る
  constructor(message: string = "Camera preview is not started", options?: { cause?: unknown }) {
    // 基底にそのまま渡す
    super(message, options);
  }
}

// 権限拒否エラー（denied / blocked の判別を code で行う）
export class PermissionDeniedError extends BaseCameraError {
  // PERMISSION_DENIED（prompt 残）または PERMISSION_BLOCKED（再 prompt 不可）
  readonly code: "PERMISSION_DENIED" | "PERMISSION_BLOCKED";
  // PERMISSION_DENIED の場合のみ true（再度 requestPermission で復帰可能）
  readonly retryable: boolean;
  // 拒否された descriptor を保持
  readonly descriptor: PermissionDescriptor;
  // 元の status（denied / blocked）
  readonly status: "denied" | "blocked";
  // constructor: descriptor 必須、status は denied 既定
  constructor(
    descriptor: PermissionDescriptor,
    options?: { status?: "denied" | "blocked"; message?: string; cause?: unknown },
  ) {
    // status を確定
    const status = options?.status ?? "denied";
    // message を確定
    const message =
      options?.message ??
      (status === "blocked"
        ? "Camera permission is blocked by the user"
        : "Camera permission was denied");
    // 基底に message / cause を渡す
    super(message, { cause: options?.cause });
    // フィールドをセット
    this.descriptor = descriptor;
    this.status = status;
    this.code = status === "blocked" ? "PERMISSION_BLOCKED" : "PERMISSION_DENIED";
    this.retryable = status === "denied";
  }
}

// 対応デバイスが存在しない・初期化失敗時のエラー
export class DeviceUnavailableError extends BaseCameraError {
  // 固定 code
  readonly code = "DEVICE_UNAVAILABLE" as const;
  // retryable は呼出側が指定（既定 false：別デバイス選び直しが必要なケースを想定）
  readonly retryable: boolean;
  // 詳細サブコード（"WINDOWS_NOT_IMPLEMENTED" など、原因を区別するためのドメイン文字列）
  readonly reason?: string;
  // constructor: reason / retryable を任意で受け取る
  constructor(
    message: string = "Camera device is not available",
    options?: { reason?: string; retryable?: boolean; cause?: unknown },
  ) {
    // 基底に渡す
    super(message, { cause: options?.cause });
    // 任意の reason
    this.reason = options?.reason;
    // 既定 false（保守的）
    this.retryable = options?.retryable ?? false;
  }
}

// 録画関連のエラー（状態遷移違反、コーデック未対応、停止失敗 等）
export class RecordingError extends BaseCameraError {
  // 固定 code（reason で詳細を区別）
  readonly code = "RECORDING_ERROR" as const;
  // 再試行可否（録画開始失敗時は再試行可、停止失敗時は不可など状況依存）
  readonly retryable: boolean;
  // 詳細サブコード（"ALREADY_RECORDING" / "NOT_RECORDING" / "UNSUPPORTED" / "UNSUPPORTED_MIME" 等）
  readonly reason: string;
  // constructor: reason 必須
  constructor(
    reason: string,
    options?: { message?: string; retryable?: boolean; cause?: unknown },
  ) {
    // message が未指定なら reason を使う
    super(options?.message ?? `Recording error: ${reason}`, { cause: options?.cause });
    // フィールドをセット
    this.reason = reason;
    this.retryable = options?.retryable ?? false;
  }
}

// バーコードスキャナ関連のエラー
export class ScannerError extends BaseCameraError {
  // 固定 code（reason で詳細を区別）
  readonly code = "SCANNER_ERROR" as const;
  // retryable は呼出側が指定（既定 false）
  readonly retryable: boolean;
  // 詳細サブコード（"ALREADY_SCANNING" / "UNSUPPORTED_FORMAT" 等）
  readonly reason: string;
  // constructor
  constructor(
    reason: string,
    options?: { message?: string; retryable?: boolean; cause?: unknown },
  ) {
    // message が未指定なら reason を使う
    super(options?.message ?? `Scanner error: ${reason}`, { cause: options?.cause });
    // フィールド設定
    this.reason = reason;
    this.retryable = options?.retryable ?? false;
  }
}

// カメラ制御操作（torch / zoom / focus / capabilities）のエラー
// RecordingError と分離することで UI 側のハンドリングを区別しやすくする
export class CameraControlError extends BaseCameraError {
  // 固定 code（reason で詳細を区別）
  readonly code = "CAMERA_CONTROL_ERROR" as const;
  // 再試行可否（"OUT_OF_RANGE" は呼出側で値を絞れば再試行可、"UNSUPPORTED" は不可）
  readonly retryable: boolean;
  // 詳細サブコード（"UNSUPPORTED" / "OUT_OF_RANGE" / "APPLY_FAILED" 等）
  readonly reason: string;
  // constructor: reason 必須
  constructor(
    reason: string,
    options?: { message?: string; retryable?: boolean; cause?: unknown },
  ) {
    // message が未指定なら reason を使う
    super(options?.message ?? `Camera control error: ${reason}`, { cause: options?.cause });
    // フィールド設定
    this.reason = reason;
    this.retryable = options?.retryable ?? false;
  }
}
