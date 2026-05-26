// core からの型とエラー
import {
  CameraControlError,
  DeviceUnavailableError,
  RecordingError,
  ScannerError,
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

// Windows 用カメラ実装の最小インターフェイス（react-native-windows の MediaCapture をラップする想定）
// 利用者が自前で実装し、createWindowsAdapter に注入する
export interface WindowsCameraImpl {
  // デバイス列挙
  listDevices?(): Promise<readonly CameraDevice[]>;
  // 権限の現在状態
  getPermission?(descriptor: PermissionDescriptor): Promise<PermissionStatus>;
  // 権限要求
  requestPermission?(descriptor: PermissionDescriptor): Promise<PermissionStatus>;
  // プレビュー開始（任意の native を Provider 経由で受け取れる）
  startPreview?(config: PreviewConfig): Promise<{ id: string; native: unknown }>;
  // プレビュー停止
  stopPreview?(handle: { id: string; native: unknown }): Promise<void>;
  // 静止画
  takePicture?(handle: { id: string; native: unknown }, options?: PhotoOptions): Promise<PhotoResult>;
  // 録画
  startRecording?(handle: { id: string; native: unknown }, options?: RecordingOptions): Promise<{ id: string; native: unknown }>;
  stopRecording?(recording: { id: string; native: unknown }): Promise<RecordingResult>;
  // バーコード
  scanBarcode?(handle: { id: string; native: unknown }, config: ScannerConfig, onScan: (r: BarcodeScanResult) => void): Promise<() => void>;
  // トーチ（Windows.Media.Capture の TorchControl をラップする想定）
  setTorch?(handle: { id: string; native: unknown }, mode: TorchMode): Promise<void>;
  // ズーム（ZoomControl をラップする想定）
  setZoom?(handle: { id: string; native: unknown }, zoom: number): Promise<void>;
  // フォーカス（FocusControl をラップする想定）
  setFocus?(handle: { id: string; native: unknown }, point?: FocusPoint): Promise<void>;
  // 能力情報（VideoDeviceController の各 Control サポート状態から構築する想定）
  getCapabilities?(handle: { id: string; native: unknown }): Promise<CameraCapabilities>;
  // 解放
  dispose?(): Promise<void>;
}

// createWindowsAdapter のオプション
export interface WindowsAdapterOptions {
  // Windows 固有の MediaCapture ラッパ実装（未指定なら全機能スタブ）
  mediaCapture?: WindowsCameraImpl;
}

// Windows 用 CameraAdapter ファクトリ
// 引数なしの場合はスタブ実装（すべて DeviceUnavailableError("WINDOWS_NOT_IMPLEMENTED") を返す）
// MediaCapture を渡せば本実装として動作する
export function createWindowsAdapter(options: WindowsAdapterOptions = {}): CameraAdapter {
  // 注入実装（未指定なら undefined）
  const impl = options.mediaCapture;

  // 未実装エラーを生成するヘルパ
  function notImplemented(reason: string): never {
    throw new DeviceUnavailableError(`Windows camera method '${reason}' is not implemented`, {
      reason: "WINDOWS_NOT_IMPLEMENTED",
    });
  }

  // CameraAdapter を返す
  return {
    id: "windows",
    listDevices: async () => {
      // 実装があれば委譲、無ければ空配列で graceful fail
      if (impl?.listDevices !== undefined) {
        return await impl.listDevices();
      }
      return [];
    },
    getPermission: async (descriptor) => {
      if (impl?.getPermission !== undefined) {
        return await impl.getPermission(descriptor);
      }
      // 未実装は unavailable
      return "unavailable";
    },
    requestPermission: async (descriptor) => {
      if (impl?.requestPermission !== undefined) {
        return await impl.requestPermission(descriptor);
      }
      return "unavailable";
    },
    startPreview: async (config) => {
      if (impl?.startPreview === undefined) {
        notImplemented("startPreview");
      }
      // 実装結果をブランド型でラップ
      const r = await impl.startPreview(config);
      return {
        __brand: "PreviewHandle",
        id: r.id,
        native: r.native,
      };
    },
    stopPreview: async (handle: PreviewHandle) => {
      if (impl?.stopPreview === undefined) {
        notImplemented("stopPreview");
      }
      await impl.stopPreview({ id: handle.id, native: handle.native });
    },
    takePicture: async (handle: PreviewHandle, opts) => {
      if (impl?.takePicture === undefined) {
        notImplemented("takePicture");
      }
      return await impl.takePicture({ id: handle.id, native: handle.native }, opts);
    },
    startRecording: async (handle: PreviewHandle, opts) => {
      if (impl?.startRecording === undefined) {
        throw new RecordingError("UNSUPPORTED", {
          message: "Windows MediaCapture is not provided",
        });
      }
      const r = await impl.startRecording({ id: handle.id, native: handle.native }, opts);
      return {
        __brand: "RecordingHandle",
        id: r.id,
        native: r.native,
      };
    },
    stopRecording: async (recording: RecordingHandle) => {
      if (impl?.stopRecording === undefined) {
        throw new RecordingError("UNSUPPORTED", {
          message: "Windows MediaCapture is not provided",
        });
      }
      return await impl.stopRecording({ id: recording.id, native: recording.native });
    },
    scanBarcode: async (handle: PreviewHandle, config, onScan) => {
      if (impl?.scanBarcode === undefined) {
        throw new ScannerError("UNSUPPORTED_FORMAT", {
          message: "Windows MediaCapture scanner is not provided",
        });
      }
      return await impl.scanBarcode({ id: handle.id, native: handle.native }, config, onScan);
    },
    setTorch: async (handle: PreviewHandle, mode: TorchMode) => {
      // impl が無ければ UNSUPPORTED
      if (impl?.setTorch === undefined) {
        throw new CameraControlError("UNSUPPORTED", {
          message: "Windows MediaCapture torch control is not provided",
        });
      }
      // impl 委譲
      await impl.setTorch({ id: handle.id, native: handle.native }, mode);
    },
    setZoom: async (handle: PreviewHandle, zoom: number) => {
      // impl が無ければ UNSUPPORTED
      if (impl?.setZoom === undefined) {
        throw new CameraControlError("UNSUPPORTED", {
          message: "Windows MediaCapture zoom control is not provided",
        });
      }
      // impl 委譲
      await impl.setZoom({ id: handle.id, native: handle.native }, zoom);
    },
    setFocus: async (handle: PreviewHandle, point?: FocusPoint) => {
      // impl が無ければ UNSUPPORTED
      if (impl?.setFocus === undefined) {
        throw new CameraControlError("UNSUPPORTED", {
          message: "Windows MediaCapture focus control is not provided",
        });
      }
      // impl 委譲
      await impl.setFocus({ id: handle.id, native: handle.native }, point);
    },
    getCapabilities: async (handle: PreviewHandle) => {
      // impl が無ければ全 false の安全フォールバック
      if (impl?.getCapabilities === undefined) {
        return {
          torch: false,
          zoom: false,
          focus: false,
          flash: false,
          exposureMode: false,
          whiteBalanceMode: false,
          iso: false,
          brightness: false,
          hdr: false,
          lowLightBoost: false,
        };
      }
      // impl 委譲
      return await impl.getCapabilities({ id: handle.id, native: handle.native });
    },
    dispose: async () => {
      if (impl?.dispose !== undefined) {
        await impl.dispose();
      }
    },
  };
}
