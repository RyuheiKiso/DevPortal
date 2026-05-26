// core からの型・エラー
import {
  CameraError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
  createDefaultIdFactory,
  type BarcodeScanResult,
  type CameraAdapter,
  type CameraDevice,
  type CameraFacing,
  type PermissionDescriptor,
  type PermissionStatus,
  type PhotoOptions,
  type PhotoResult,
  type PreviewConfig,
  type PreviewHandle,
  type RecordingHandle,
  type RecordingOptions,
  type RecordingResult,
  type ScannerConfig,
} from "@k1s0-ts-camera/core";

// react-native-vision-camera v4 の最小限の型（duck typed、本体は optional peer）
// 利用者は createVisionCameraAdapter にライブラリ参照を渡し、私たちはそれ経由で操作する
export interface VisionCameraLibrary {
  // Camera クラス（static API）
  Camera: {
    // デバイス一覧
    getAvailableCameraDevices: () => Promise<ReadonlyArray<VisionCameraDevice>>;
    // 権限照会・要求
    getCameraPermissionStatus: () => string;
    getMicrophonePermissionStatus: () => string;
    requestCameraPermission: () => Promise<string>;
    requestMicrophonePermission: () => Promise<string>;
  };
}

// VisionCamera の Device 型最小サブセット
export interface VisionCameraDevice {
  // 一意 ID
  id: string;
  // 表示名
  name: string;
  // 位置（"front" / "back" / "external"）
  position: string;
}

// CameraView ref が公開する API のサブセット（撮影・録画の即時呼び出し用）
export interface VisionCameraRef {
  // 静止画
  takePhoto: (options?: { quality?: number; flash?: "auto" | "on" | "off" }) => Promise<{ path: string; width: number; height: number }>;
  // 録画
  startRecording: (options: { onRecordingFinished: (video: { path: string; duration: number }) => void; onRecordingError: (err: unknown) => void; fileType?: string }) => void;
  // 録画停止
  stopRecording: () => Promise<void>;
}

// 利用者が提供する Camera ref 取得関数（Provider で <Camera ref={...} /> をレンダリングし、その ref を adapter に渡す）
export type VisionCameraRefAccessor = () => VisionCameraRef | null;

// createVisionCameraAdapter のオプション
export interface VisionCameraAdapterOptions {
  // vision-camera ライブラリ参照（必須）
  library: VisionCameraLibrary;
  // Camera ref（利用者がレンダリングして渡す）
  cameraRef: VisionCameraRefAccessor;
  // ID 生成（テスト用）
  idFactory?: () => string;
  // 時刻取得（テスト用）
  now?: () => number;
}

// vision-camera 権限文字列を PermissionStatus にマップ
function mapVisionPermission(value: string): PermissionStatus {
  // vision-camera v4 の戻り値：granted / not-determined / denied / restricted
  if (value === "granted") {
    return "granted";
  }
  if (value === "not-determined") {
    return "prompt";
  }
  if (value === "denied") {
    return "blocked";
  }
  if (value === "restricted") {
    return "unavailable";
  }
  return "unavailable";
}

// vision-camera の position を CameraFacing にマップ
function mapFacing(position: string): CameraFacing | undefined {
  if (position === "front") {
    return "front";
  }
  if (position === "back") {
    return "back";
  }
  if (position === "external") {
    return "external";
  }
  return undefined;
}

// vision-camera 用 CameraAdapter ファクトリ
export function createVisionCameraAdapter(options: VisionCameraAdapterOptions): CameraAdapter {
  // ID factory
  const idFactory = options.idFactory ?? createDefaultIdFactory();
  // 時刻
  const now = options.now ?? (() => Date.now());
  // ライブラリ参照
  const lib = options.library;
  // 内部 state
  let currentPreview: PreviewHandle | undefined;
  // 録画完了時の resolve / reject
  let recordingResolve: ((result: { path: string; duration: number }) => void) | null = null;
  let recordingReject: ((err: unknown) => void) | null = null;
  // 録画開始時刻
  let recordingStartedAt: number | undefined;

  // CameraRef を取得（無ければ throw）
  function requireRef(): VisionCameraRef {
    const ref = options.cameraRef();
    if (ref === null) {
      throw new CameraError("vision-camera ref is not ready", { code: "REF_UNAVAILABLE" });
    }
    return ref;
  }

  // CameraAdapter を返す
  return {
    id: "vision-camera",
    listDevices: async (): Promise<readonly CameraDevice[]> => {
      // ライブラリ経由で取得し、CameraDevice 型に整形
      const devices = await lib.Camera.getAvailableCameraDevices();
      return devices.map((d) => ({
        id: d.id,
        label: d.name,
        facing: mapFacing(d.position),
      }));
    },
    getPermission: async (descriptor: PermissionDescriptor): Promise<PermissionStatus> => {
      // camera と microphone を確認し worst を返す
      const camStatus = mapVisionPermission(lib.Camera.getCameraPermissionStatus());
      if (descriptor.microphone === true) {
        const micStatus = mapVisionPermission(lib.Camera.getMicrophonePermissionStatus());
        // worst を取得
        const order: Record<PermissionStatus, number> = {
          unavailable: 4,
          blocked: 3,
          denied: 2,
          prompt: 1,
          granted: 0,
        };
        return order[micStatus] > order[camStatus] ? micStatus : camStatus;
      }
      return camStatus;
    },
    requestPermission: async (descriptor: PermissionDescriptor): Promise<PermissionStatus> => {
      // camera を要求
      const camResult = mapVisionPermission(await lib.Camera.requestCameraPermission());
      if (camResult === "blocked") {
        throw new PermissionDeniedError(descriptor, { status: "blocked" });
      }
      // microphone も要求した場合
      if (descriptor.microphone === true) {
        const micResult = mapVisionPermission(await lib.Camera.requestMicrophonePermission());
        if (micResult === "blocked") {
          throw new PermissionDeniedError(descriptor, { status: "blocked" });
        }
        // worst を返す
        const order: Record<PermissionStatus, number> = {
          unavailable: 4,
          blocked: 3,
          denied: 2,
          prompt: 1,
          granted: 0,
        };
        return order[micResult] > order[camResult] ? micResult : camResult;
      }
      return camResult;
    },
    startPreview: async (config: PreviewConfig): Promise<PreviewHandle> => {
      // vision-camera はコンポーネント描画でプレビューが開始する。adapter としては論理的なハンドルだけを発行する
      const handle: PreviewHandle = {
        __brand: "PreviewHandle",
        id: idFactory(),
        native: { config },
      };
      currentPreview = handle;
      return handle;
    },
    stopPreview: async (handle: PreviewHandle): Promise<void> => {
      // 内部ハンドルが一致する場合のみ参照クリア
      if (currentPreview?.id === handle.id) {
        currentPreview = undefined;
      }
    },
    takePicture: async (
      handle: PreviewHandle,
      opts?: PhotoOptions,
    ): Promise<PhotoResult> => {
      // ハンドル整合性
      if (currentPreview?.id !== handle.id) {
        throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
      }
      const ref = requireRef();
      // vision-camera の takePhoto を呼び出し
      const photo = await ref.takePhoto({ quality: opts?.quality, flash: opts?.flash });
      return {
        id: idFactory(),
        media: {
          kind: "filePath",
          path: photo.path,
          mimeType: opts?.mimeType ?? "image/jpeg",
        },
        width: photo.width,
        height: photo.height,
        capturedAt: now(),
      };
    },
    startRecording: async (
      handle: PreviewHandle,
      opts?: RecordingOptions,
    ): Promise<RecordingHandle> => {
      if (currentPreview?.id !== handle.id) {
        throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
      }
      const ref = requireRef();
      // 録画 ID を発行
      const id = idFactory();
      recordingStartedAt = now();
      // vision-camera の startRecording を呼び出し（コールバック方式）
      ref.startRecording({
        onRecordingFinished: (video) => {
          // stopRecording の Promise を解決する（recordingResolve は stopRecording 内でセットされる前提）
          /* v8 ignore next */
          if (recordingResolve !== null) {
            recordingResolve(video);
            recordingResolve = null;
            recordingReject = null;
          }
        },
        onRecordingError: (err) => {
          // stopRecording の Promise を reject（recordingReject は stopRecording 内でセットされる前提）
          /* v8 ignore next */
          if (recordingReject !== null) {
            recordingReject(err);
            recordingResolve = null;
            recordingReject = null;
          }
        },
        fileType: opts?.mimeType,
      });
      return {
        __brand: "RecordingHandle",
        id,
        native: { id },
      };
    },
    stopRecording: async (recording: RecordingHandle): Promise<RecordingResult> => {
      const ref = requireRef();
      // resolve / reject を仕掛けて stop 呼び出し
      const result = await new Promise<{ path: string; duration: number }>((resolve, reject) => {
        recordingResolve = resolve;
        recordingReject = reject;
        ref.stopRecording().catch((err) => {
          // stop 自体の失敗（recordingReject はこの直前でセット済み）
          /* v8 ignore next */
          if (recordingReject !== null) {
            recordingReject(new RecordingError("STOP_FAILED", { cause: err }));
            recordingResolve = null;
            recordingReject = null;
          }
        });
      });
      // 結果整形
      return {
        id: recording.id,
        media: {
          kind: "filePath",
          path: result.path,
          mimeType: "video/mp4",
        },
        // duration は vision-camera から秒単位で返るため ms に変換
        // recordingStartedAt は startRecording 内で必ずセットされるので else は防御コード
        /* v8 ignore next */
        durationMs: recordingStartedAt !== undefined ? now() - recordingStartedAt : result.duration * 1000,
      };
    },
    scanBarcode: async (
      _handle: PreviewHandle,
      _config: ScannerConfig,
      _onScan: (r: BarcodeScanResult) => void,
    ): Promise<() => void> => {
      // vision-camera では Frame Processor + plugin が必要。本 adapter では未対応として明示
      throw new ScannerError("UNSUPPORTED_FORMAT", {
        message:
          "vision-camera barcode scanning requires a Frame Processor plugin. Use a custom adapter for this feature.",
      });
    },
    dispose: async (): Promise<void> => {
      // adapter 固有の state を解放
      currentPreview = undefined;
      recordingResolve = null;
      recordingReject = null;
    },
  };
}
