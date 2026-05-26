// 型のみ取り込み（実体は manager / 利用側で生成）
import type {
  BarcodeScanResult,
  CameraCapabilities,
  CameraDevice,
  FocusPoint,
  PermissionDescriptor,
  PermissionStatus,
  PhotoOptions,
  PhotoResult,
  PreviewConfig,
  PreviewHandle,
  RecordingHandle,
  RecordingOptions,
  RecordingResult,
  ScannerConfig,
  TorchMode,
} from "./types.js";

// プラットフォーム固有の生 API を抽象化する責務
// CameraManager 配下のロジックはこの interface 経由でしかネイティブを触らない
export interface CameraAdapter {
  // アダプタ識別子（"web" / "vision-camera" / "expo-camera" / "windows" など、ログ表示用）
  readonly id: string;
  // 利用可能デバイスの列挙（解放済みカメラも含む）
  listDevices(): Promise<readonly CameraDevice[]>;
  // 権限状態を非破壊で照会する（OS の許可ダイアログは出さない）
  getPermission(descriptor: PermissionDescriptor): Promise<PermissionStatus>;
  // 権限要求を実行する（OS の許可ダイアログを起動し、結果を返す）
  requestPermission(descriptor: PermissionDescriptor): Promise<PermissionStatus>;
  // プレビュー開始（戻り値のハンドルは stopPreview 等に渡す）
  startPreview(config: PreviewConfig): Promise<PreviewHandle>;
  // プレビュー停止（同じ handle を渡す）
  stopPreview(handle: PreviewHandle): Promise<void>;
  // 静止画キャプチャ（前提: startPreview 済み）
  takePicture(handle: PreviewHandle, options?: PhotoOptions): Promise<PhotoResult>;
  // 録画開始（戻り値の RecordingHandle を以降の制御で使う）
  startRecording(handle: PreviewHandle, options?: RecordingOptions): Promise<RecordingHandle>;
  // 録画停止して成果物 RecordingResult を返す
  stopRecording(recording: RecordingHandle): Promise<RecordingResult>;
  // 録画一時停止（対応端末のみ実装。未対応なら省略可）
  pauseRecording?(recording: RecordingHandle): Promise<void>;
  // 録画再開（対応端末のみ実装）
  resumeRecording?(recording: RecordingHandle): Promise<void>;
  // バーコードスキャン購読（コールバック方式、戻り値で購読解除）
  scanBarcode(
    handle: PreviewHandle,
    config: ScannerConfig,
    onScan: (result: BarcodeScanResult) => void,
  ): Promise<() => void>;
  // トーチ（持続点灯）モードの切替（対応端末のみ実装）
  setTorch?(handle: PreviewHandle, mode: TorchMode): Promise<void>;
  // ズーム倍率の設定（対応端末のみ実装）
  setZoom?(handle: PreviewHandle, zoom: number): Promise<void>;
  // フォーカス制御（対応端末のみ実装。point 未指定で連続 AF へ戻す想定）
  setFocus?(handle: PreviewHandle, point?: FocusPoint): Promise<void>;
  // 現在のプレビューに紐づく能力情報を取得（対応端末のみ実装）
  getCapabilities?(handle: PreviewHandle): Promise<CameraCapabilities>;
  // アダプタ自体の解放（ハードウェア閉鎖、event 購読解除）
  dispose(): Promise<void>;
}
