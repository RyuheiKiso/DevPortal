// core からの型・エラー
import {
  CameraControlError,
  CameraError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
  createDefaultIdFactory,
  type BarcodeScanResult,
  type CameraAdapter,
  type CameraCapabilities,
  type CameraDevice,
  type FocusPoint,
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
  type TorchMode,
} from "@k1s0-ts-camera/core";

// expo-camera v15+ の最小限の型
// 利用者は ref を渡し、本 adapter は ref 経由でカメラを操作する
export interface ExpoCameraRef {
  // 静止画
  takePictureAsync: (options?: { quality?: number; base64?: boolean }) => Promise<{ uri: string; width: number; height: number; base64?: string }>;
  // 録画開始（Promise が録画完了で resolve）
  recordAsync: (options?: { maxDuration?: number; maxFileSize?: number; quality?: string }) => Promise<{ uri: string }>;
  // 録画停止
  stopRecording: () => void;
}

// expo-camera の権限 hook 戻り値（簡易）
export interface ExpoCameraPermissionApi {
  // 現在の権限照会
  getCameraPermissionsAsync: () => Promise<{ status: string }>;
  // 権限要求
  requestCameraPermissionsAsync: () => Promise<{ status: string }>;
  // マイク権限（オプション）
  getMicrophonePermissionsAsync?: () => Promise<{ status: string }>;
  requestMicrophonePermissionsAsync?: () => Promise<{ status: string }>;
  // デバイス列挙
  getAvailableCameraTypesAsync?: () => Promise<readonly string[]>;
}

// torch / zoom / focus を adapter から発火するための注入関数群
// expo-camera は宣言的 prop のみのため、利用者は React state setter を渡す前提
export interface ExpoCameraControls {
  // トーチ ON/OFF（CameraView の enableTorch prop と紐付ける setter）
  setTorch?: (mode: TorchMode) => void | Promise<void>;
  // ズーム（CameraView の zoom prop 0..1 と紐付ける setter）
  setZoom?: (zoom: number) => void | Promise<void>;
  // タップフォーカス（独自実装の setter）
  setFocus?: (point?: FocusPoint) => void | Promise<void>;
}

// createExpoCameraAdapter のオプション
export interface ExpoCameraAdapterOptions {
  // ref 取得関数（Provider 配下で <CameraView ref={...} /> をレンダリングし、その ref を渡す）
  cameraRef: () => ExpoCameraRef | null;
  // expo-camera の権限関連 API（モジュール本体を渡す）
  permissionApi: ExpoCameraPermissionApi;
  // torch / zoom / focus の注入（無いものは UNSUPPORTED として扱う）
  controls?: ExpoCameraControls;
  // ID 生成
  idFactory?: () => string;
  // 時刻取得
  now?: () => number;
}

// expo-camera の status を PermissionStatus にマップ
function mapStatus(value: string): PermissionStatus {
  // expo の値: granted / denied / undetermined
  if (value === "granted") {
    return "granted";
  }
  if (value === "denied") {
    return "blocked";
  }
  if (value === "undetermined") {
    return "prompt";
  }
  return "unavailable";
}

// expo-camera 用 CameraAdapter ファクトリ
export function createExpoCameraAdapter(options: ExpoCameraAdapterOptions): CameraAdapter {
  // ID factory
  const idFactory = options.idFactory ?? createDefaultIdFactory();
  // 時刻
  const now = options.now ?? (() => Date.now());
  // 内部 state
  let currentPreview: PreviewHandle | undefined;
  // 録画停止用の resolve / reject
  let recordingResolve: ((result: { uri: string }) => void) | null = null;
  let recordingReject: ((err: unknown) => void) | null = null;
  // recordAsync の完了が stopRecording 待ち合わせより先に発生した場合に保留する
  let pendingRecordingResult: { uri: string } | undefined;
  let pendingRecordingError: unknown | undefined;
  let recordingStartedAt: number | undefined;

  // ref 取得（無ければ throw）
  function requireRef(): ExpoCameraRef {
    const ref = options.cameraRef();
    if (ref === null) {
      throw new CameraError("expo-camera ref is not ready", { code: "REF_UNAVAILABLE" });
    }
    return ref;
  }

  return {
    id: "expo-camera",
    listDevices: async (): Promise<readonly CameraDevice[]> => {
      // expo-camera は明示的なデバイス列挙 API が限定的。getAvailableCameraTypesAsync があれば使用
      if (options.permissionApi.getAvailableCameraTypesAsync !== undefined) {
        const types = await options.permissionApi.getAvailableCameraTypesAsync();
        return types.map((t, i) => ({
          id: t,
          label: t,
          facing: t === "front" || t === "back" || t === "external" ? (t as "front" | "back" | "external") : undefined,
        }));
      }
      // 未実装環境では空配列
      return [];
    },
    getPermission: async (descriptor: PermissionDescriptor): Promise<PermissionStatus> => {
      const cam = mapStatus((await options.permissionApi.getCameraPermissionsAsync()).status);
      if (descriptor.microphone === true && options.permissionApi.getMicrophonePermissionsAsync !== undefined) {
        const mic = mapStatus((await options.permissionApi.getMicrophonePermissionsAsync()).status);
        const order: Record<PermissionStatus, number> = {
          unavailable: 4,
          blocked: 3,
          denied: 2,
          prompt: 1,
          granted: 0,
        };
        return order[mic] > order[cam] ? mic : cam;
      }
      return cam;
    },
    requestPermission: async (descriptor: PermissionDescriptor): Promise<PermissionStatus> => {
      const cam = mapStatus((await options.permissionApi.requestCameraPermissionsAsync()).status);
      if (cam === "blocked") {
        throw new PermissionDeniedError(descriptor, { status: "blocked" });
      }
      if (descriptor.microphone === true && options.permissionApi.requestMicrophonePermissionsAsync !== undefined) {
        const mic = mapStatus((await options.permissionApi.requestMicrophonePermissionsAsync()).status);
        if (mic === "blocked") {
          throw new PermissionDeniedError(descriptor, { status: "blocked" });
        }
        const order: Record<PermissionStatus, number> = {
          unavailable: 4,
          blocked: 3,
          denied: 2,
          prompt: 1,
          granted: 0,
        };
        return order[mic] > order[cam] ? mic : cam;
      }
      return cam;
    },
    startPreview: async (config: PreviewConfig): Promise<PreviewHandle> => {
      const handle: PreviewHandle = {
        __brand: "PreviewHandle",
        id: idFactory(),
        native: { config },
      };
      currentPreview = handle;
      return handle;
    },
    stopPreview: async (handle: PreviewHandle): Promise<void> => {
      if (currentPreview?.id === handle.id) {
        currentPreview = undefined;
      }
    },
    takePicture: async (
      handle: PreviewHandle,
      opts?: PhotoOptions,
    ): Promise<PhotoResult> => {
      if (currentPreview?.id !== handle.id) {
        throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
      }
      const ref = requireRef();
      const photo = await ref.takePictureAsync({ quality: opts?.quality });
      return {
        id: idFactory(),
        media: {
          kind: "filePath",
          path: photo.uri,
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
      const id = idFactory();
      // 前回の録画で stopRecording を呼ばれずに pending に残っていた結果 / エラーをクリア
      // これを忘れると新セッションの stopRecording が古い録画結果を返してしまう
      pendingRecordingResult = undefined;
      pendingRecordingError = undefined;
      recordingStartedAt = now();
      // recordAsync は録画完了で resolve する Promise を返す
      // resolve / reject 両方を捕捉し、stopRecording が後で来た場合に備えて pending にも保存
      ref
        .recordAsync({
          maxDuration: opts?.maxDurationMs !== undefined ? Math.floor(opts.maxDurationMs / 1000) : undefined,
          maxFileSize: opts?.maxFileSizeBytes,
        })
        .then((result) => {
          // stopRecording 既存時はその場で resolve
          if (recordingResolve !== null) {
            recordingResolve(result);
            recordingResolve = null;
            recordingReject = null;
          } else {
            // 未呼び出しなら結果を保留
            pendingRecordingResult = result;
          }
        })
        .catch((err) => {
          if (recordingReject !== null) {
            recordingReject(err);
            recordingResolve = null;
            recordingReject = null;
          } else {
            pendingRecordingError = err;
          }
        });
      return {
        __brand: "RecordingHandle",
        id,
        native: { id },
      };
    },
    stopRecording: async (recording: RecordingHandle): Promise<RecordingResult> => {
      const ref = requireRef();
      // 既に recordAsync が解決済みなら即時返却
      if (pendingRecordingResult !== undefined) {
        const cached = pendingRecordingResult;
        pendingRecordingResult = undefined;
        return {
          id: recording.id,
          media: {
            kind: "filePath",
            path: cached.uri,
            mimeType: "video/mp4",
          },
          // recordingStartedAt は startRecording 内で必ずセットされるので 0 分岐は防御コード
          /* v8 ignore next */
          durationMs: recordingStartedAt !== undefined ? now() - recordingStartedAt : 0,
        };
      }
      // 既にエラーが保留されているなら投げ直す
      if (pendingRecordingError !== undefined) {
        const cachedError = pendingRecordingError;
        pendingRecordingError = undefined;
        throw cachedError;
      }
      const result = await new Promise<{ uri: string }>((resolve, reject) => {
        recordingResolve = resolve;
        recordingReject = reject;
        try {
          ref.stopRecording();
        } catch (err) {
          recordingReject?.(new RecordingError("STOP_FAILED", { cause: err }));
          recordingResolve = null;
          recordingReject = null;
        }
      });
      return {
        id: recording.id,
        media: {
          kind: "filePath",
          path: result.uri,
          mimeType: "video/mp4",
        },
        // recordingStartedAt は startRecording 内で必ずセットされるので 0 分岐は防御コード
        /* v8 ignore next */
        durationMs: recordingStartedAt !== undefined ? now() - recordingStartedAt : 0,
      };
    },
    scanBarcode: async (
      _handle: PreviewHandle,
      _config: ScannerConfig,
      _onScan: (r: BarcodeScanResult) => void,
    ): Promise<() => void> => {
      // expo-camera のバーコード機能は CameraView の onBarcodeScanned prop で扱う設計のため、adapter では未実装
      throw new ScannerError("UNSUPPORTED_FORMAT", {
        message:
          "expo-camera barcode scanning is handled via the CameraView onBarcodeScanned prop, not via this adapter.",
      });
    },
    setTorch: async (handle: PreviewHandle, mode: TorchMode): Promise<void> => {
      // ハンドル整合性チェック
      if (currentPreview?.id !== handle.id) {
        throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
      }
      // controls.setTorch が無ければ UNSUPPORTED
      const setter = options.controls?.setTorch;
      if (setter === undefined) {
        throw new CameraControlError("UNSUPPORTED", {
          message: "controls.setTorch was not provided to createExpoCameraAdapter",
        });
      }
      // 同期 / 非同期両対応で待機
      try {
        await Promise.resolve(setter(mode));
      } catch (err) {
        throw new CameraControlError("APPLY_FAILED", { cause: err });
      }
    },
    setZoom: async (handle: PreviewHandle, zoom: number): Promise<void> => {
      // ハンドル整合性チェック
      if (currentPreview?.id !== handle.id) {
        throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
      }
      // controls.setZoom が無ければ UNSUPPORTED
      const setter = options.controls?.setZoom;
      if (setter === undefined) {
        throw new CameraControlError("UNSUPPORTED", {
          message: "controls.setZoom was not provided to createExpoCameraAdapter",
        });
      }
      // 同期 / 非同期両対応で待機
      try {
        await Promise.resolve(setter(zoom));
      } catch (err) {
        throw new CameraControlError("APPLY_FAILED", { cause: err });
      }
    },
    setFocus: async (handle: PreviewHandle, point?: FocusPoint): Promise<void> => {
      // ハンドル整合性チェック
      if (currentPreview?.id !== handle.id) {
        throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
      }
      // controls.setFocus が無ければ UNSUPPORTED
      const setter = options.controls?.setFocus;
      if (setter === undefined) {
        throw new CameraControlError("UNSUPPORTED", {
          message: "controls.setFocus was not provided to createExpoCameraAdapter",
        });
      }
      // 同期 / 非同期両対応で待機
      try {
        await Promise.resolve(setter(point));
      } catch (err) {
        throw new CameraControlError("APPLY_FAILED", { cause: err });
      }
    },
    getCapabilities: async (handle: PreviewHandle): Promise<CameraCapabilities> => {
      // ハンドル整合性チェック
      if (currentPreview?.id !== handle.id) {
        throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
      }
      // expo-camera は capability API が無いため、controls の存在から推定する
      const controls = options.controls;
      return {
        // torch は controls 存在で対応とみなす
        torch: controls?.setTorch !== undefined,
        // zoom は固定 range 0..1（expo-camera の仕様に合わせる）
        zoom:
          controls?.setZoom !== undefined ? { min: 0, max: 1, step: 0.01 } : (false as const),
        // focus は tap のみ（continuous は autofocus prop で別管理）
        focus:
          controls?.setFocus !== undefined
            ? { tap: true, continuous: false }
            : (false as const),
        // フラッシュは controls.setTorch と同義に扱う（expo-camera では prop が共用）
        flash: controls?.setTorch !== undefined,
        // 露出 / WB / ISO / 明度の独自 API なし
        exposureMode: false,
        whiteBalanceMode: false,
        iso: false,
        brightness: false,
        // HDR / lowLightBoost も独自 API なし
        hdr: false,
        lowLightBoost: false,
      };
    },
    dispose: async (): Promise<void> => {
      currentPreview = undefined;
      recordingResolve = null;
      recordingReject = null;
      // pending も明示的にクリアして次セッションへの混入を完全に断つ
      pendingRecordingResult = undefined;
      pendingRecordingError = undefined;
    },
  };
}
