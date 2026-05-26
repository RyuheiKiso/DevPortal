// 型一式を取り込み
import type {
  BarcodeScanResult,
  CameraCapabilities,
  CameraDevice,
  CameraEvent,
  CameraListener,
  CameraManager,
  CameraManagerConfig,
  FocusPoint,
  PermissionDescriptor,
  PermissionStatus,
  PhotoOptions,
  PhotoResult,
  PreviewConfig,
  PreviewHandle,
  RecordingOptions,
  RecordingResult,
  RecordingSession,
  RecordingState,
  ScannerConfig,
  TorchMode,
} from "./types.js";
// アダプタ型
import type { CameraAdapter } from "./adapter.js";
// 各種エラー
import {
  CameraControlError,
  CameraError,
  CameraNotReadyError,
  RecordingError,
  ScannerError,
} from "./errors.js";
// 状態機械
import { RecordingStateMachine } from "./recording.js";
// イベントエミッタ
import { CameraEventEmitter } from "./events.js";
// 既定 ID ファクトリ
import { createDefaultIdFactory } from "./id.js";

// createCameraManager のファクトリ関数
// adapter を必須で受け取り、設定は任意
export function createCameraManager(
  adapter: CameraAdapter,
  config: CameraManagerConfig = {},
): CameraManager {
  // 時刻取得関数（テスト差し替え可）
  const now = config.now ?? (() => Date.now());
  // ID 生成関数（テスト差し替え可）
  const idFactory = config.idFactory ?? createDefaultIdFactory();
  // 状態機械（録画用）
  const stateMachine = new RecordingStateMachine();
  // イベントエミッタ
  const emitter = new CameraEventEmitter();
  // 現在のプレビューハンドル
  let previewHandle: PreviewHandle | undefined;
  // 現在の録画ネイティブハンドル（adapter 由来）
  let currentRecording: import("./types.js").RecordingHandle | undefined;
  // 録画開始時刻（duration 計測用）
  let recordingStartedAt: number | undefined;
  // 進行中のスキャナ購読解除関数
  let scannerUnsubscribe: (() => void) | undefined;
  // 直近スキャン結果（throttle 判定で参照、現状 manager では呼出側で重複抑止）
  // dispose 済みフラグ（dispose 後の操作を弾く）
  let disposed = false;

  // 内部: dispose 済みなら CameraError 風に弾く（ただし冪等性のため getter は除外）
  function ensureNotDisposed(): void {
    // dispose 後の write 操作は拒否
    if (disposed) {
      // 致命: 状態を壊さないため CameraError 系を投げる
      throw new CameraNotReadyError("CameraManager has been disposed");
    }
  }

  // 内部: プレビューが開始済みか確認し、未開始なら CameraNotReadyError
  function ensurePreviewReady(): PreviewHandle {
    // 未開始は CameraNotReadyError
    if (previewHandle === undefined) {
      throw new CameraNotReadyError();
    }
    // ハンドルを返す
    return previewHandle;
  }

  // 内部: adapter の呼び出しを try/catch で包み、失敗時は error イベントを emit してから rethrow
  async function runAdapter<T>(operation: () => Promise<T>): Promise<T> {
    try {
      // adapter 呼び出し
      return await operation();
    } catch (err) {
      // CameraError 系統のみ event に乗せる（型ガードで判定するのは大袈裟なので CameraError 系の duck typing）
      const at = now();
      // 既知 CameraError 系統なら event 化（CameraError union への代入は emit シグネチャに合わせて局所 cast する）
      if (isCameraErrorLike(err)) {
        // emit の error 型は CameraError 系の union だが、duck typing で同形と判明済みのため局所 cast で渡す
        emitter.emit({ type: "error", error: err as CameraError, at });
      }
      // 元の例外を rethrow（呼出側で握る）
      throw err;
    }
  }

  // 内部 duck typing: CameraError 系統 (code + retryable プロパティ) を持つかで判定
  // 戻り値の type predicate は `code: string; retryable: boolean` を持つ任意オブジェクト
  function isCameraErrorLike(
    value: unknown,
  ): value is { code: string; retryable: boolean; message?: string } {
    // null / プリミティブは即 false
    if (value === null || typeof value !== "object") {
      return false;
    }
    // code が string、retryable が boolean、ともに Error 由来か
    const candidate = value as { code?: unknown; retryable?: unknown };
    return typeof candidate.code === "string" && typeof candidate.retryable === "boolean";
  }

  // listDevices: adapter にそのまま委譲
  async function listDevices(): Promise<readonly CameraDevice[]> {
    // dispose 後は不可
    ensureNotDisposed();
    // adapter 呼び出し
    return await runAdapter(() => adapter.listDevices());
  }

  // 権限照会
  async function getPermission(descriptor: PermissionDescriptor): Promise<PermissionStatus> {
    // dispose 後は不可
    ensureNotDisposed();
    // adapter 呼び出し
    const status = await runAdapter(() => adapter.getPermission(descriptor));
    // permission-change イベントを emit（変化検出は呼出側に委ねる）
    emitter.emit({ type: "permission-change", descriptor, status, at: now() });
    // 結果を返却
    return status;
  }

  // 権限要求
  async function requestPermission(descriptor: PermissionDescriptor): Promise<PermissionStatus> {
    // dispose 後は不可
    ensureNotDisposed();
    // adapter 呼び出し
    const status = await runAdapter(() => adapter.requestPermission(descriptor));
    // permission-change イベントを emit
    emitter.emit({ type: "permission-change", descriptor, status, at: now() });
    return status;
  }

  // プレビュー開始
  async function startPreview(previewConfig: PreviewConfig = {}): Promise<PreviewHandle> {
    // dispose 後は不可
    ensureNotDisposed();
    // 既に開始済みなら一度停止してから上書き
    if (previewHandle !== undefined) {
      // 旧ハンドルの stop を試みる（失敗しても続行）
      try {
        await adapter.stopPreview(previewHandle);
      } catch {
        // 旧ハンドル停止失敗は無視
      }
      // ハンドル参照をクリア
      previewHandle = undefined;
    }
    // adapter 呼び出し
    const handle = await runAdapter(() => adapter.startPreview(previewConfig));
    // await 中に dispose されていた場合、取得した handle を即時解放してリークを防ぐ
    if (disposed) {
      // adapter 側に handle 解放を依頼し、失敗は無視（既に adapter.dispose 済みのことがある）
      try {
        await adapter.stopPreview(handle);
      } catch {
        // 解放失敗は無視
      }
      // 呼出側には CameraNotReadyError を返す（dispose 後の状態を明確に伝える）
      throw new CameraNotReadyError("CameraManager has been disposed");
    }
    // 状態を更新
    previewHandle = handle;
    // event 配信
    emitter.emit({ type: "preview-start", handle, at: now() });
    return handle;
  }

  // プレビュー停止
  async function stopPreview(): Promise<void> {
    // dispose 後は不可
    ensureNotDisposed();
    // 未開始なら何もしない（idempotent）
    if (previewHandle === undefined) {
      return;
    }
    // 現在ハンドルを退避
    const handle = previewHandle;
    // 先に参照をクリア（adapter throw 時の二重 stop を避ける）
    previewHandle = undefined;
    // スキャナが動いていれば併せて停止
    if (scannerUnsubscribe !== undefined) {
      scannerUnsubscribe();
      scannerUnsubscribe = undefined;
    }
    // 録画中なら state を idle に戻す（adapter の停止は呼出側責任）
    if (stateMachine.state !== "idle") {
      stateMachine.reset();
      currentRecording = undefined;
      recordingStartedAt = undefined;
    }
    // adapter 呼び出し
    await runAdapter(() => adapter.stopPreview(handle));
    // event 配信
    emitter.emit({ type: "preview-stop", handleId: handle.id, at: now() });
  }

  // 現在のプレビューハンドル取得
  function getPreviewHandle(): PreviewHandle | undefined {
    return previewHandle;
  }

  // 静止画撮影
  async function takePicture(options?: PhotoOptions): Promise<PhotoResult> {
    // dispose 後は不可
    ensureNotDisposed();
    // プレビュー未開始なら CameraNotReadyError
    const handle = ensurePreviewReady();
    // adapter 呼び出し
    const result = await runAdapter(() => adapter.takePicture(handle, options));
    // event 配信
    emitter.emit({ type: "photo", result, at: now() });
    return result;
  }

  // 録画開始
  async function startRecording(options?: RecordingOptions): Promise<RecordingSession> {
    // dispose 後は不可
    ensureNotDisposed();
    // プレビュー未開始なら CameraNotReadyError
    const handle = ensurePreviewReady();
    // 既に録画中なら RecordingError
    if (stateMachine.state !== "idle") {
      // 状態遷移チェック以外のドメインエラーとして専用 reason で投げる
      throw new RecordingError("ALREADY_RECORDING");
    }
    // adapter 呼び出し
    const recording = await runAdapter(() => adapter.startRecording(handle, options));
    // await 中に dispose されていた場合、取得した RecordingHandle を即時解放してリーク回避
    if (disposed) {
      // adapter 側に録画停止を依頼し、失敗は無視
      try {
        await adapter.stopRecording(recording);
      } catch {
        // 解放失敗は無視
      }
      // 呼出側には CameraNotReadyError を返す
      throw new CameraNotReadyError("CameraManager has been disposed");
    }
    // 状態遷移
    stateMachine.transitionTo("recording");
    // ハンドルと開始時刻を保持
    currentRecording = recording;
    recordingStartedAt = now();
    // event 配信
    emitter.emit({ type: "recording-start", recordingId: recording.id, at: recordingStartedAt });
    // 高レベル session オブジェクトを返す
    const session: RecordingSession = {
      // ID は adapter ハンドルの ID を踏襲
      id: recording.id,
      // state ゲッターは現在状態を返す（クロージャ参照ではなく動的取得）
      get state(): RecordingState {
        return stateMachine.state;
      },
      // 録画停止
      stop: async (): Promise<RecordingResult> => {
        // dispose 後は不可
        ensureNotDisposed();
        // 既に idle なら NOT_RECORDING
        if (stateMachine.state === "idle" || currentRecording === undefined) {
          throw new RecordingError("NOT_RECORDING");
        }
        // adapter 呼び出し
        const result = await runAdapter(() =>
          adapter.stopRecording(currentRecording as import("./types.js").RecordingHandle),
        );
        // 状態を idle に戻す
        stateMachine.transitionTo("idle");
        // 参照をクリア
        currentRecording = undefined;
        recordingStartedAt = undefined;
        // event 配信
        emitter.emit({ type: "recording-stop", result, at: now() });
        return result;
      },
      // 一時停止
      pause: async (): Promise<void> => {
        // dispose 後は不可
        ensureNotDisposed();
        // 録画中以外はエラー
        if (stateMachine.state !== "recording" || currentRecording === undefined) {
          throw new RecordingError("NOT_RECORDING");
        }
        // adapter が未対応なら UNSUPPORTED
        if (adapter.pauseRecording === undefined) {
          throw new RecordingError("UNSUPPORTED");
        }
        // adapter 呼び出し
        await runAdapter(() =>
          (adapter.pauseRecording as NonNullable<typeof adapter.pauseRecording>)(
            currentRecording as import("./types.js").RecordingHandle,
          ),
        );
        // 状態遷移
        stateMachine.transitionTo("paused");
        // event 配信
        emitter.emit({ type: "recording-pause", recordingId: recording.id, at: now() });
      },
      // 再開
      resume: async (): Promise<void> => {
        // dispose 後は不可
        ensureNotDisposed();
        // 一時停止中以外はエラー
        if (stateMachine.state !== "paused" || currentRecording === undefined) {
          throw new RecordingError("NOT_PAUSED");
        }
        // adapter 未対応
        if (adapter.resumeRecording === undefined) {
          throw new RecordingError("UNSUPPORTED");
        }
        // adapter 呼び出し
        await runAdapter(() =>
          (adapter.resumeRecording as NonNullable<typeof adapter.resumeRecording>)(
            currentRecording as import("./types.js").RecordingHandle,
          ),
        );
        // 状態遷移
        stateMachine.transitionTo("recording");
        // event 配信
        emitter.emit({ type: "recording-resume", recordingId: recording.id, at: now() });
      },
    };
    return session;
  }

  // 現在の録画状態
  function getRecordingState(): RecordingState {
    // 状態機械の getter をそのまま転送
    return stateMachine.state;
  }

  // バーコードスキャン購読開始
  async function startScanning(
    scannerConfig: ScannerConfig,
    onScan: (result: BarcodeScanResult) => void,
  ): Promise<() => void> {
    // dispose 後は不可
    ensureNotDisposed();
    // プレビュー未開始なら CameraNotReadyError
    const handle = ensurePreviewReady();
    // 既に購読中なら ScannerError
    if (scannerUnsubscribe !== undefined) {
      throw new ScannerError("ALREADY_SCANNING");
    }
    // adapter 経由でスキャンを開始（adapter は購読解除関数を返す）
    const unsubscribeFromAdapter = await runAdapter(() =>
      adapter.scanBarcode(handle, scannerConfig, (result) => {
        // 受け取った結果を呼出側コールバックに転送
        onScan(result);
        // event 配信
        emitter.emit({ type: "scan", result, at: now() });
      }),
    );
    // await 中に dispose されていた場合、取得した unsubscribe を即時呼んでスキャナを止める
    if (disposed) {
      // adapter 側のスキャナ停止を試行し、失敗は無視
      try {
        unsubscribeFromAdapter();
      } catch {
        // 解除失敗は無視
      }
      // 呼出側には CameraNotReadyError を返す
      throw new CameraNotReadyError("CameraManager has been disposed");
    }
    // 解除関数を組み立て
    const unsubscribe = (): void => {
      // 既に解除済みなら無視
      if (scannerUnsubscribe === undefined) {
        return;
      }
      // adapter の解除を呼ぶ
      try {
        unsubscribeFromAdapter();
      } catch {
        // 解除失敗は無視
      }
      // 参照をクリア
      scannerUnsubscribe = undefined;
    };
    // 内部参照に保存
    scannerUnsubscribe = unsubscribe;
    return unsubscribe;
  }

  // スキャン中フラグ
  function isScanning(): boolean {
    // unsubscribe 関数の存在で判定
    return scannerUnsubscribe !== undefined;
  }

  // 全 false の能力情報（adapter 未対応時のフォールバック）
  function emptyCapabilities(): CameraCapabilities {
    // 「対応無し」を全フィールドで明示する安全側の値
    return {
      // トーチ未対応
      torch: false,
      // ズーム未対応
      zoom: false,
      // フォーカス未対応
      focus: false,
      // フラッシュ未対応
      flash: false,
      // 露出モード未対応
      exposureMode: false,
      // ホワイトバランス未対応
      whiteBalanceMode: false,
      // ISO 未対応
      iso: false,
      // 明度未対応
      brightness: false,
      // HDR 未対応
      hdr: false,
      // 低照度ブースト未対応
      lowLightBoost: false,
    };
  }

  // トーチモード切替
  async function setTorch(mode: TorchMode): Promise<void> {
    // dispose 後は不可
    ensureNotDisposed();
    // プレビュー未開始なら CameraNotReadyError
    const handle = ensurePreviewReady();
    // adapter 未対応なら UNSUPPORTED
    if (adapter.setTorch === undefined) {
      throw new CameraControlError("UNSUPPORTED", {
        message: "Torch control is not supported by this adapter",
      });
    }
    // adapter 呼び出し（エラーは event 化して rethrow）
    await runAdapter(() =>
      (adapter.setTorch as NonNullable<typeof adapter.setTorch>)(handle, mode),
    );
  }

  // ズーム倍率の設定
  async function setZoom(zoom: number): Promise<void> {
    // dispose 後は不可
    ensureNotDisposed();
    // プレビュー未開始なら CameraNotReadyError
    const handle = ensurePreviewReady();
    // adapter 未対応なら UNSUPPORTED
    if (adapter.setZoom === undefined) {
      throw new CameraControlError("UNSUPPORTED", {
        message: "Zoom control is not supported by this adapter",
      });
    }
    // adapter 呼び出し
    await runAdapter(() =>
      (adapter.setZoom as NonNullable<typeof adapter.setZoom>)(handle, zoom),
    );
  }

  // フォーカス制御
  async function setFocus(point?: FocusPoint): Promise<void> {
    // dispose 後は不可
    ensureNotDisposed();
    // 入力検証: point が渡されているなら x, y はいずれも 0..1 範囲内（NaN も拒否）
    // 相対座標規約に反する値を adapter 側に流さず、core で早期 reject する
    if (point !== undefined) {
      // NaN / 範囲外をまとめて検出（Number.isFinite + 比較）
      const inRange = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 1;
      if (!inRange(point.x) || !inRange(point.y)) {
        // OUT_OF_RANGE で reject（adapter は呼ばないため error event も emit しない）
        throw new CameraControlError("OUT_OF_RANGE", {
          message: `FocusPoint x/y must be in 0..1, got: x=${point.x}, y=${point.y}`,
        });
      }
    }
    // プレビュー未開始なら CameraNotReadyError
    const handle = ensurePreviewReady();
    // adapter 未対応なら UNSUPPORTED
    if (adapter.setFocus === undefined) {
      throw new CameraControlError("UNSUPPORTED", {
        message: "Focus control is not supported by this adapter",
      });
    }
    // adapter 呼び出し
    await runAdapter(() =>
      (adapter.setFocus as NonNullable<typeof adapter.setFocus>)(handle, point),
    );
  }

  // 能力情報の取得
  async function getCapabilities(): Promise<CameraCapabilities> {
    // dispose 後は不可
    ensureNotDisposed();
    // プレビュー未開始なら CameraNotReadyError
    const handle = ensurePreviewReady();
    // adapter 未対応なら全 false のフォールバックを返す
    if (adapter.getCapabilities === undefined) {
      return emptyCapabilities();
    }
    // adapter 呼び出し
    return await runAdapter(() =>
      (adapter.getCapabilities as NonNullable<typeof adapter.getCapabilities>)(handle),
    );
  }

  // イベント購読
  function subscribe(listener: CameraListener): () => void {
    // emitter にそのまま委譲
    return emitter.subscribe(listener);
  }

  // マネージャ全体の dispose
  async function dispose(): Promise<void> {
    // 二重 dispose は無害化
    if (disposed) {
      return;
    }
    // フラグを立てる
    disposed = true;
    // スキャナ停止
    if (scannerUnsubscribe !== undefined) {
      scannerUnsubscribe();
      scannerUnsubscribe = undefined;
    }
    // 録画中なら adapter に停止を促す（結果は捨てる）
    if (currentRecording !== undefined) {
      try {
        await adapter.stopRecording(currentRecording);
      } catch {
        // 失敗しても続行
      }
      currentRecording = undefined;
      recordingStartedAt = undefined;
      stateMachine.reset();
    }
    // プレビュー停止
    if (previewHandle !== undefined) {
      try {
        await adapter.stopPreview(previewHandle);
      } catch {
        // 失敗しても続行
      }
      previewHandle = undefined;
    }
    // adapter 自体を dispose
    try {
      await adapter.dispose();
    } catch {
      // 失敗しても続行
    }
    // リスナをクリア
    emitter.clear();
  }

  // ID factory の未使用警告抑止: ID 生成は将来の機能拡張で使う
  // 現状は adapter 側で発行するため manager 内では使わない
  void idFactory;

  // CameraManager オブジェクトを返す
  const manager: CameraManager = {
    // adapter ID（読み取り専用）
    adapterId: adapter.id,
    listDevices,
    getPermission,
    requestPermission,
    startPreview,
    stopPreview,
    getPreviewHandle,
    takePicture,
    startRecording,
    getRecordingState,
    startScanning,
    isScanning,
    setTorch,
    setZoom,
    setFocus,
    getCapabilities,
    subscribe,
    dispose,
  };
  return manager;
}
