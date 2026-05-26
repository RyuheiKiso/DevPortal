// CapturedMedia 判別共用体（実装は media.ts、型のみ取り込み）
import type { CapturedMedia } from "./media.js";
// 各種エラーの型を取り込み（CameraEvent で参照するため）
import type {
  CameraControlError,
  CameraError,
  CameraNotReadyError,
  DeviceUnavailableError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
} from "./errors.js";

// カメラの向き（前面 / 背面 / 外部）
export type CameraFacing = "front" | "back" | "external";

// プレビュー解像度のヒント（実装側がデバイスに合わせて近似する）
export interface CameraResolution {
  // 幅（px）
  width: number;
  // 高さ（px）
  height: number;
}

// 列挙されるカメラデバイス 1 件の情報
export interface CameraDevice {
  // 一意 ID（ハードウェア識別子）
  id: string;
  // 表示名（人間可読、UI で選択肢に出す用途）
  label: string;
  // 推定 facing（取得不能なら undefined）
  facing?: CameraFacing;
  // サポートされる解像度のヒント一覧（取得不能なら undefined）
  supportedResolutions?: readonly CameraResolution[];
}

// プレビュー開始時の構成
export interface PreviewConfig {
  // 利用するデバイス ID（未指定なら facing で選択 → それも未指定なら既定）
  deviceId?: string;
  // 利用する向き（deviceId 指定時はそちらを優先）
  facing?: CameraFacing;
  // 期待解像度（近似一致）
  resolution?: CameraResolution;
  // フレームレート（fps、未指定なら端末既定）
  frameRate?: number;
  // 音声トラックを含めるか（録画前提）
  audio?: boolean;
  // 描画先のターゲット（Web では HTMLVideoElement、RN では未使用）
  target?: unknown;
}

// プレビューハンドル（ブランド付き opaque 型、利用者は中身に触らない）
export interface PreviewHandle {
  // ブランド識別子
  readonly __brand: "PreviewHandle";
  // 内部 ID
  readonly id: string;
  // プラットフォーム固有のネイティブ値（adapter のみ参照）
  readonly native: unknown;
}

// 静止画撮影オプション
export interface PhotoOptions {
  // JPEG 品質（0-1）
  quality?: number;
  // MIME（image/jpeg または image/png）
  mimeType?: "image/jpeg" | "image/png";
  // フラッシュ動作
  flash?: "auto" | "on" | "off";
  // EXIF 付与可否（既定 false でプライバシ配慮）
  includeExif?: boolean;
}

// 静止画撮影結果
export interface PhotoResult {
  // 一意 ID
  id: string;
  // 撮影成果物
  media: CapturedMedia;
  // 撮影解像度の幅
  width: number;
  // 撮影解像度の高さ
  height: number;
  // 撮影時刻（epoch ms）
  capturedAt: number;
}

// 動画録画オプション
export interface RecordingOptions {
  // MIME（video/mp4 / video/webm 等、未指定なら実装既定）
  mimeType?: string;
  // 最大録画時間（ms、未指定は無制限）
  maxDurationMs?: number;
  // 最大サイズ（bytes、未指定は無制限）
  maxFileSizeBytes?: number;
  // 音声を含めるか（既定 true）
  audio?: boolean;
  // 録画ビットレート（bps、未指定は実装既定）
  videoBitsPerSecond?: number;
}

// 録画ハンドル（opaque）
export interface RecordingHandle {
  // ブランド識別子
  readonly __brand: "RecordingHandle";
  // 一意 ID
  readonly id: string;
  // プラットフォーム固有のネイティブ値
  readonly native: unknown;
}

// 録画状態（state machine）
export type RecordingState = "idle" | "recording" | "paused";

// 録画完了結果
export interface RecordingResult {
  // 一意 ID（startRecording 時に発行された値）
  id: string;
  // 録画成果物
  media: CapturedMedia;
  // 実録画時間（ms）
  durationMs: number;
  // ファイルサイズ（bytes、取得不能なら undefined）
  sizeBytes?: number;
}

// 録画セッション（高レベル API で利用者に返す制御ハンドル）
export interface RecordingSession {
  // 録画 ID
  id: string;
  // 現在の状態
  state: RecordingState;
  // 停止して結果を取得
  stop: () => Promise<RecordingResult>;
  // 一時停止（adapter が対応していなければ RecordingError）
  pause: () => Promise<void>;
  // 再開（adapter が対応していなければ RecordingError）
  resume: () => Promise<void>;
}

// バーコード形式（W3C BarcodeDetector の format 一覧と vision-camera の codeTypes を統合）
export type BarcodeFormat =
  | "qr_code"
  | "code_39"
  | "code_93"
  | "code_128"
  | "codabar"
  | "data_matrix"
  | "ean_8"
  | "ean_13"
  | "itf"
  | "pdf417"
  | "upc_a"
  | "upc_e"
  | "aztec";

// バーコードスキャナの設定
export interface ScannerConfig {
  // 検出対象形式（未指定なら ["qr_code"]）
  formats?: readonly BarcodeFormat[];
  // 重複検出の抑制時間（ms、未指定なら 0 = 抑制なし）
  throttleMs?: number;
  // 検出領域（プレビュー全体に対する相対座標 0-1、未指定なら全領域）
  region?: { x: number; y: number; width: number; height: number };
}

// 1 件のバーコードスキャン結果
export interface BarcodeScanResult {
  // 一意 ID
  id: string;
  // 形式
  format: BarcodeFormat;
  // デコード後のペイロード文字列
  value: string;
  // 検出時刻（epoch ms）
  scannedAt: number;
  // 検出領域の bounding box（プレビュー画素座標、取得不能なら undefined）
  boundingBox?: { x: number; y: number; width: number; height: number };
}

// トーチ（持続点灯ライト）モード
// "on" = 点灯維持 / "off" = 消灯
export type TorchMode = "on" | "off";

// タップフォーカスの座標（プレビュー画面の相対座標）
// 左上 (0,0) 〜 右下 (1,1) で指定する
export interface FocusPoint {
  // X 座標（0..1）
  x: number;
  // Y 座標（0..1）
  y: number;
}

// レンジ表現（最小値・最大値・任意 step）
export interface CapabilityRange {
  // 取りうる最小値
  min: number;
  // 取りうる最大値
  max: number;
  // 連続可変が前提のときの推奨ステップ（未指定なら任意精度）
  step?: number;
}

// カメラデバイスの能力情報（MediaTrackCapabilities 相当の拡張版）
// 未対応の項目は `false` で示し、対応している項目は具体オブジェクトを格納する
export interface CameraCapabilities {
  // トーチ（持続点灯）対応の可否
  torch: boolean;
  // ズーム対応の可否と range（false = 未対応）
  zoom: CapabilityRange | false;
  // フォーカス能力（tap = タップフォーカス、continuous = 連続 AF）
  focus: { tap: boolean; continuous: boolean } | false;
  // フラッシュ（撮影時の瞬間発光）対応の可否
  flash: boolean;
  // 露出モード一覧（"continuous" / "manual" / "single-shot" 等。false = 未対応）
  exposureMode: readonly string[] | false;
  // ホワイトバランスモード一覧（"continuous" / "manual" 等。false = 未対応）
  whiteBalanceMode: readonly string[] | false;
  // ISO 感度 range（false = 未対応）
  iso: CapabilityRange | false;
  // 明度 range（false = 未対応）
  brightness: CapabilityRange | false;
  // HDR 対応の可否
  hdr: boolean;
  // 低照度ブースト対応の可否
  lowLightBoost: boolean;
}

// 権限ステータス（W3C Permissions API と RN PermissionStatus の統合）
export type PermissionStatus = "granted" | "denied" | "prompt" | "blocked" | "unavailable";

// 権限要求の対象を指定する descriptor
export interface PermissionDescriptor {
  // カメラ本体（必須 true）
  camera: boolean;
  // 動画録音で必要なマイク
  microphone?: boolean;
  // 撮影成果物保存用のメディアライブラリ
  mediaLibrary?: boolean;
}

// CameraManager のイベント種別
export type CameraEventType =
  | "preview-start"
  | "preview-stop"
  | "photo"
  | "recording-start"
  | "recording-stop"
  | "recording-pause"
  | "recording-resume"
  | "scan"
  | "permission-change"
  | "error";

// イベント本体（種別ごとに payload が異なる判別共用体）
export type CameraEvent =
  | { type: "preview-start"; handle: PreviewHandle; at: number }
  | { type: "preview-stop"; handleId: string; at: number }
  | { type: "photo"; result: PhotoResult; at: number }
  | { type: "recording-start"; recordingId: string; at: number }
  | { type: "recording-stop"; result: RecordingResult; at: number }
  | { type: "recording-pause"; recordingId: string; at: number }
  | { type: "recording-resume"; recordingId: string; at: number }
  | { type: "scan"; result: BarcodeScanResult; at: number }
  | { type: "permission-change"; descriptor: PermissionDescriptor; status: PermissionStatus; at: number }
  | {
      type: "error";
      // 発生した CameraError 系統エラー
      error:
        | CameraError
        | CameraNotReadyError
        | PermissionDeniedError
        | DeviceUnavailableError
        | RecordingError
        | ScannerError
        | CameraControlError;
      at: number;
    };

// イベント購読リスナ
export type CameraListener = (event: CameraEvent) => void;

// CameraManager 生成時の設定
export interface CameraManagerConfig {
  // 時刻取得関数（テスト差し替え可、既定 Date.now）
  now?: () => number;
  // ID 生成関数（テスト差し替え可、既定 createDefaultIdFactory）
  idFactory?: () => string;
}

// CameraManager の公開インターフェース
export interface CameraManager {
  // 接続中のアダプタ ID（ログ用）
  readonly adapterId: string;
  // デバイス一覧の取得
  listDevices(): Promise<readonly CameraDevice[]>;
  // 権限状態の照会（OS ダイアログを出さない）
  getPermission(descriptor: PermissionDescriptor): Promise<PermissionStatus>;
  // 権限要求（OS ダイアログを起動）
  requestPermission(descriptor: PermissionDescriptor): Promise<PermissionStatus>;
  // プレビュー開始
  startPreview(config?: PreviewConfig): Promise<PreviewHandle>;
  // プレビュー停止（明示的に停止する場合）
  stopPreview(): Promise<void>;
  // 現在のプレビューハンドルを取得（未開始なら undefined）
  getPreviewHandle(): PreviewHandle | undefined;
  // 静止画撮影
  takePicture(options?: PhotoOptions): Promise<PhotoResult>;
  // 動画録画開始
  startRecording(options?: RecordingOptions): Promise<RecordingSession>;
  // 現在の録画状態
  getRecordingState(): RecordingState;
  // バーコードスキャン購読開始（戻り値は購読解除関数）
  startScanning(
    config: ScannerConfig,
    onScan: (result: BarcodeScanResult) => void,
  ): Promise<() => void>;
  // 現在のスキャン中フラグ
  isScanning(): boolean;
  // トーチ（持続点灯）モードの切替（adapter 未対応なら CameraControlError("UNSUPPORTED")）
  setTorch(mode: TorchMode): Promise<void>;
  // ズーム倍率の設定（adapter 未対応なら CameraControlError("UNSUPPORTED")、範囲外なら "OUT_OF_RANGE"）
  setZoom(zoom: number): Promise<void>;
  // フォーカス制御（point 指定でタップフォーカス、未指定で連続 AF へ戻す）
  setFocus(point?: FocusPoint): Promise<void>;
  // 現在のプレビューに対する能力情報を取得（adapter 未対応時は全 false の安全フォールバック）
  getCapabilities(): Promise<CameraCapabilities>;
  // イベント購読（戻り値は購読解除関数）
  subscribe(listener: CameraListener): () => void;
  // マネージャ全体の後始末（プレビュー停止 + アダプタ dispose）
  dispose(): Promise<void>;
}
