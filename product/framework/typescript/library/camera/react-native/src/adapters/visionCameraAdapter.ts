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
  type CameraFacing,
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
  // フラッシュ／トーチ保有
  hasFlash?: boolean;
  // ズーム下限・上限（device 由来）
  minZoom?: number;
  maxZoom?: number;
  // フォーカスロックの可否
  supportsFocusLocking?: boolean;
  // 露出ロックの可否
  supportsExposureLocking?: boolean;
  // 低照度ブーストの可否
  supportsLowLightBoost?: boolean;
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

// 利用者が提供する device 取得関数（capabilities 構築・controls の対象 device を識別するために使う）
export type VisionCameraDeviceAccessor = () => VisionCameraDevice | null;

// torch / zoom / focus を adapter から命令的に発火するための注入関数群
// vision-camera v4 では `<Camera>` に渡す state を React 側で持つのが基本のため、
// 利用者はそれぞれの setter を adapter に注入する
export interface VisionCameraControls {
  // トーチモード切替（"on" / "off"）
  setTorch?: (mode: TorchMode) => void | Promise<void>;
  // ズーム倍率の設定（device.minZoom..maxZoom）
  setZoom?: (zoom: number) => void | Promise<void>;
  // フォーカス制御（point ありで tap、なしで autofocus へ戻す）
  setFocus?: (point?: FocusPoint) => void | Promise<void>;
}

// createVisionCameraAdapter のオプション
export interface VisionCameraAdapterOptions {
  // vision-camera ライブラリ参照（必須）
  library: VisionCameraLibrary;
  // Camera ref（利用者がレンダリングして渡す）
  cameraRef: VisionCameraRefAccessor;
  // 現在 device を取得する関数（capabilities 構築用、optional）
  device?: VisionCameraDeviceAccessor;
  // torch / zoom / focus の注入（無いものは UNSUPPORTED として扱う）
  controls?: VisionCameraControls;
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
  // stopRecording 呼出前に vision-camera 側から onRecordingFinished / onRecordingError が
  // 先行発火した場合の結果 / エラーを保留する pending 変数
  let pendingRecordingResult: { path: string; duration: number } | undefined;
  let pendingRecordingError: unknown | undefined;
  // 現在の録画セッションを識別するトークン（startRecording 毎に更新、dispose で undefined）
  // 旧セッションの onRecordingFinished / onRecordingError closure が遅延発火しても
  // トークン不一致で silent drop される
  let currentRecordingSessionId: string | undefined;

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
      // 前回録画の pending を必ずクリア（stopRecording を呼ばれなかったセッションの残骸が
      // 新セッションの stopRecording で誤って返るのを防ぐ）
      pendingRecordingResult = undefined;
      pendingRecordingError = undefined;
      // 新セッションのトークンを発行し currentRecordingSessionId に登録
      // 旧セッションの closure はこの id を捕捉し、不一致なら silent drop
      const sessionId = id;
      currentRecordingSessionId = sessionId;
      recordingStartedAt = now();
      // vision-camera の startRecording を呼び出し（コールバック方式）
      ref.startRecording({
        onRecordingFinished: (video) => {
          // 旧セッションの遅延 callback は無視（cross-session pollution 防止）
          if (sessionId !== currentRecordingSessionId) {
            return;
          }
          // 既に stopRecording が resolve を待っているなら即解決、無ければ pending に保留する
          if (recordingResolve !== null) {
            recordingResolve(video);
            recordingResolve = null;
            recordingReject = null;
          } else {
            // stopRecording 呼出前に finished が来たケース（端末側の自動停止など）
            pendingRecordingResult = video;
          }
        },
        onRecordingError: (err) => {
          // 旧セッションの遅延 callback は無視
          if (sessionId !== currentRecordingSessionId) {
            return;
          }
          // native の素エラーを RecordingError("RECORDER_ERROR") にラップ
          // webAdapter / runAdapter / event 化と整合させる
          const wrapped = new RecordingError("RECORDER_ERROR", { cause: err });
          // 既に stopRecording が reject を待っているなら即拒否、無ければ pending に保留
          if (recordingReject !== null) {
            recordingReject(wrapped);
            recordingResolve = null;
            recordingReject = null;
          } else {
            // stopRecording 呼出前に error が来たケース
            pendingRecordingError = wrapped;
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
      // 既に pending result が積まれていればそれを返却（vision-camera が先行発火したケース）
      if (pendingRecordingResult !== undefined) {
        const cached = pendingRecordingResult;
        pendingRecordingResult = undefined;
        return {
          id: recording.id,
          media: {
            kind: "filePath",
            path: cached.path,
            mimeType: "video/mp4",
          },
          // recordingStartedAt は startRecording で必ずセット、未セット時は秒→ms 換算で fallback
          /* v8 ignore next */
          durationMs: recordingStartedAt !== undefined ? now() - recordingStartedAt : cached.duration * 1000,
        };
      }
      // pending error が積まれていればそれを投げ直す
      if (pendingRecordingError !== undefined) {
        const cachedError = pendingRecordingError;
        pendingRecordingError = undefined;
        throw cachedError;
      }
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
    setTorch: async (handle: PreviewHandle, mode: TorchMode): Promise<void> => {
      // ハンドル整合性チェック
      if (currentPreview?.id !== handle.id) {
        throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
      }
      // controls.setTorch が無ければ UNSUPPORTED
      const setter = options.controls?.setTorch;
      if (setter === undefined) {
        throw new CameraControlError("UNSUPPORTED", {
          message: "controls.setTorch was not provided to createVisionCameraAdapter",
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
          message: "controls.setZoom was not provided to createVisionCameraAdapter",
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
          message: "controls.setFocus was not provided to createVisionCameraAdapter",
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
      // device 取得関数が無ければ controls の有無のみから推定（device 由来情報は全て false）
      const device = options.device?.() ?? null;
      const controls = options.controls;
      // zoom range は device 由来。両方とも数値なら range を組み立てる
      const zoomRange =
        device?.minZoom !== undefined && device?.maxZoom !== undefined
          ? { min: device.minZoom, max: device.maxZoom }
          : (false as const);
      // CameraCapabilities にマップ
      return {
        // torch は controls.setTorch があり、device.hasFlash が true のときのみ true
        torch: controls?.setTorch !== undefined && device?.hasFlash === true,
        // zoom は controls.setZoom があり、device 由来 range が取れるときのみ
        zoom: controls?.setZoom !== undefined ? zoomRange : (false as const),
        // focus は controls.setFocus があり、device.supportsFocusLocking が true のときのみ
        focus:
          controls?.setFocus !== undefined && device?.supportsFocusLocking === true
            ? { tap: true, continuous: true }
            : (false as const),
        // フラッシュ自体は device.hasFlash で判定
        flash: device?.hasFlash === true,
        // 露出モードは device.supportsExposureLocking から推定
        exposureMode: device?.supportsExposureLocking === true ? (["continuous", "manual"] as const) : (false as const),
        // ホワイトバランスは vision-camera v4 では device API がないため未対応で返す
        whiteBalanceMode: false,
        // ISO / 明度は device API なし
        iso: false,
        brightness: false,
        // HDR は vision-camera では Camera component prop なので adapter 経由では未対応
        hdr: false,
        // 低照度ブースト
        lowLightBoost: device?.supportsLowLightBoost === true,
      };
    },
    dispose: async (): Promise<void> => {
      // adapter 固有の state を解放
      currentPreview = undefined;
      recordingResolve = null;
      recordingReject = null;
      // pending も明示的にクリアしてメモリを開放
      pendingRecordingResult = undefined;
      pendingRecordingError = undefined;
      // セッショントークンを undefined にすることで、dispose 後の callback も silent drop
      currentRecordingSessionId = undefined;
    },
  };
}
