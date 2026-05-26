// Context（高度利用者向け）
export { CameraContext } from "./context.js";

// Provider
export { CameraProvider } from "./CameraProvider.js";
export type { CameraProviderProps } from "./CameraProvider.js";

// 基本 hooks
export { useCamera, useCameraDevices, useCameraPermission, useCameraEvents } from "./hooks.js";

// プレビュー hook
export { useCameraPreview } from "./previewHooks.js";
export type { UseCameraPreviewResult } from "./previewHooks.js";

// 録画 hook
export { useRecording } from "./recordingHooks.js";
export type { UseRecordingResult } from "./recordingHooks.js";

// バーコードスキャナ hook
export { useBarcodeScanner } from "./scannerHooks.js";
export type { UseBarcodeScannerResult } from "./scannerHooks.js";

// Web 用 adapter のファクトリ
export { createWebAdapter } from "./webAdapter.js";
export type { WebAdapterOptions } from "./webAdapter.js";

// BarcodeDetector 関連
export { defaultBarcodeDetectorFactory } from "./barcodeDetector.js";
export type {
  BarcodeDetectorFactory,
  BarcodeDetectorLike,
  BarcodeDetectorEntry,
} from "./barcodeDetector.js";
