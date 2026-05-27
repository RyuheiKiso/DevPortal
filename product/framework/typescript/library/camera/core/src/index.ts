// 型の re-export 群（実体コードは生成しない）
export type {
  CameraFacing,
  CameraResolution,
  CameraDevice,
  PreviewConfig,
  PreviewHandle,
  PhotoOptions,
  PhotoResult,
  RecordingOptions,
  RecordingHandle,
  RecordingState,
  RecordingResult,
  RecordingSession,
  BarcodeFormat,
  ScannerConfig,
  BarcodeScanResult,
  PermissionStatus,
  PermissionDescriptor,
  CameraEventType,
  CameraEvent,
  CameraListener,
  CameraManagerConfig,
  CameraManager,
  TorchMode,
  FocusPoint,
  CapabilityRange,
  CameraCapabilities,
} from "./types.js";

// CapturedMedia 型と type guard
export type { CapturedMedia } from "./media.js";
export { isBlobMedia, isDataUrlMedia, isFilePathMedia } from "./media.js";

// エラー群
export {
  BaseCameraError,
  CameraError,
  CameraNotReadyError,
  PermissionDeniedError,
  DeviceUnavailableError,
  RecordingError,
  ScannerError,
  CameraControlError,
} from "./errors.js";

// 権限ヘルパ
export {
  isPermissionGranted,
  canRequestPermission,
  shouldOpenSettings,
} from "./permission.js";

// バーコード ヘルパ
export { isBarcodeFormat, shouldEmitScan } from "./barcode.js";

// 環境判定ヘルパ
export { getNodeEnv, isDevelopment, isProduction } from "./env.js";

// ID factory
export { createDefaultIdFactory, fallbackId } from "./id.js";

// イベントエミッタ（高度利用者向け）
export { CameraEventEmitter } from "./events.js";

// 状態機械（高度利用者向け）
export { RecordingStateMachine } from "./recording.js";

// CameraAdapter インターフェイス（型のみ）
export type { CameraAdapter } from "./adapter.js";

// マネージャファクトリ
export { createCameraManager } from "./manager.js";

// zod スキーマ
export {
  cameraFacingSchema,
  cameraResolutionSchema,
  photoOptionsSchema,
  recordingOptionsSchema,
  barcodeFormatSchema,
  scannerConfigSchema,
  previewConfigSchema,
  cameraManagerConfigSchema,
  permissionDescriptorSchema,
  validateCameraConfig,
} from "./schema.js";
export type { CameraManagerConfigInput } from "./schema.js";

// ロガーブリッジ
export { attachLoggerBridge } from "./logger.js";
export type { LoggerLike, AttachLoggerOptions } from "./logger.js";

// 通知ブリッジ
export { attachNotificationBridge } from "./notification.js";
export type {
  NotificationManagerLike,
  AttachNotificationOptions,
} from "./notification.js";
