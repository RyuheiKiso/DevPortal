// core からの型・エラー・util を取り込み
import {
  CameraControlError,
  CameraError,
  DeviceUnavailableError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
  createDefaultIdFactory,
  shouldEmitScan,
  type BarcodeFormat,
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
// BarcodeDetector ファクトリ
import {
  defaultBarcodeDetectorFactory,
  type BarcodeDetectorFactory,
} from "./barcodeDetector.js";

// createWebAdapter のオプション
export interface WebAdapterOptions {
  // BarcodeDetector の生成関数を差し替えたい場合に渡す（テスト・ポリフィル用）
  barcodeDetectorFactory?: BarcodeDetectorFactory;
  // ID 生成関数を差し替え（テスト用）
  idFactory?: () => string;
  // 時刻取得関数を差し替え（テスト用）
  now?: () => number;
  // requestAnimationFrame 相当を差し替え（テスト用、戻り値の cancel は呼ばないがフレーム駆動に必要）
  scheduler?: {
    // 1 フレーム後にコールバックを呼ぶ
    schedule: (cb: () => void) => unknown;
    // schedule の戻り値で取り消す
    cancel: (handle: unknown) => void;
  };
}

// MediaTrackCapabilities の最小サブセット型（lib.dom.d.ts と互換のうえで member を絞る）
// 端末や Chrome バージョンによって有無が分かれるため optional でモデル化する
interface MediaTrackCapabilitiesLike {
  // トーチサポート可否（boolean 配列で渡る環境もあるため unknown で受ける）
  torch?: boolean | readonly boolean[];
  // ズーム range（min/max/step を持つオブジェクト）
  zoom?: { min: number; max: number; step?: number };
  // フォーカスモード一覧
  focusMode?: readonly string[];
  // 露出モード一覧
  exposureMode?: readonly string[];
  // ホワイトバランスモード一覧
  whiteBalanceMode?: readonly string[];
  // ISO range
  iso?: { min: number; max: number };
  // 明度 range
  brightness?: { min: number; max: number; step?: number };
}

// MediaStreamTrack の最小サブセット型（kind は元から必須、capabilities/applyConstraints は optional）
type MediaStreamTrackLike = {
  // 停止
  stop: () => void;
  // トラック種別（"video" / "audio"）
  readonly kind: string;
  // 能力情報の取得（Chromium 系のみ提供）
  getCapabilities?: () => MediaTrackCapabilitiesLike;
  // 動的な constraints 適用（Chromium 系のみ提供）
  applyConstraints?: (constraints: { advanced?: ReadonlyArray<Record<string, unknown>> }) => Promise<void>;
};

// MediaStream 用の minimum 型（lib.dom.d.ts と互換のうえで member を絞る）
type MediaStreamLike = {
  getTracks: () => Array<MediaStreamTrackLike>;
};

// MediaRecorder の minimum 型
type MediaRecorderLike = {
  // ondataavailable / onstop / onerror を listener 形式で受け取る
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  // 状態（既定 inactive）
  readonly state: string;
  // メソッド
  start: (timeslice?: number) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
};

// MediaRecorder コンストラクタ型
type MediaRecorderCtor = new (
  stream: MediaStreamLike,
  options?: { mimeType?: string; videoBitsPerSecond?: number },
) => MediaRecorderLike & {
  // isTypeSupported は static だが、ここでは別 path で参照
  readonly mimeType: string;
};

// MediaRecorder の static
type MediaRecorderStatic = {
  isTypeSupported?: (type: string) => boolean;
};

// navigator.mediaDevices の minimum 型
type MediaDevicesLike = {
  getUserMedia: (constraints: { audio?: boolean; video?: unknown }) => Promise<MediaStreamLike>;
  enumerateDevices: () => Promise<readonly { kind: string; deviceId: string; label?: string }[]>;
};

// navigator.permissions の minimum 型（W3C Permissions API）
type PermissionsLike = {
  query: (descriptor: { name: string }) => Promise<{ state: string }>;
};

// 内部参照のためのプレビュー native（adapter スコープ）
interface PreviewNative {
  // 取得済みストリーム
  stream: MediaStreamLike;
  // プレビューを attach した HTMLVideoElement（target 指定があれば）
  videoElement?: HTMLVideoElement;
  // 選択された MIME（録画用に保持）
  audio: boolean;
}

// 録画 native（adapter スコープ）
interface RecordingNative {
  // MediaRecorder インスタンス
  recorder: MediaRecorderLike;
  // chunks
  chunks: Blob[];
  // 利用 MIME
  mimeType: string;
  // 開始時刻
  startedAt: number;
  // 停止 Promise の resolver
  stopResolve: ((result: RecordingResult) => void) | null;
  // 停止 Promise の rejecter
  stopReject: ((err: unknown) => void) | null;
}

// 内部 state（adapter インスタンス間で共有しない、createWebAdapter ごとに独立）
interface AdapterState {
  // 現在のプレビュー（複数同時開始は想定しない）
  preview: { handle: PreviewHandle; native: PreviewNative } | undefined;
  // 現在の録画
  recording: { handle: RecordingHandle; native: RecordingNative } | undefined;
  // 現在のスキャナ unsubscribe
  scannerCancel: (() => void) | undefined;
}

// 既定のスケジューラ（requestAnimationFrame / cancelAnimationFrame に委譲、無ければ setTimeout）
const defaultScheduler: NonNullable<WebAdapterOptions["scheduler"]> = {
  // フレーム後にコールバックを実行
  schedule: (cb) => {
    // requestAnimationFrame があれば使う
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number })
      .requestAnimationFrame;
    if (raf !== undefined) {
      return raf(cb);
    }
    // 無ければ setTimeout で 16ms 待つ（60fps 相当）
    return setTimeout(cb, 16) as unknown as number;
  },
  // schedule の戻り値で取り消す
  cancel: (handle) => {
    // cancelAnimationFrame があれば使う
    const caf = (globalThis as { cancelAnimationFrame?: (h: number) => void })
      .cancelAnimationFrame;
    if (caf !== undefined && typeof handle === "number") {
      caf(handle);
      return;
    }
    // フォールバック clearTimeout
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

// Web 環境用の CameraAdapter ファクトリ
export function createWebAdapter(options: WebAdapterOptions = {}): CameraAdapter {
  // ID 生成
  const idFactory = options.idFactory ?? createDefaultIdFactory();
  // 時刻取得
  const now = options.now ?? (() => Date.now());
  // BarcodeDetector ファクトリ
  const barcodeDetectorFactory =
    options.barcodeDetectorFactory ?? defaultBarcodeDetectorFactory;
  // スケジューラ
  const scheduler = options.scheduler ?? defaultScheduler;
  // インスタンス内 state
  const state: AdapterState = {
    preview: undefined,
    recording: undefined,
    scannerCancel: undefined,
  };

  // navigator.mediaDevices を取得（無ければ DeviceUnavailableError）
  function getMediaDevices(): MediaDevicesLike {
    // global 経由
    const md = (globalThis as { navigator?: { mediaDevices?: MediaDevicesLike } }).navigator
      ?.mediaDevices;
    // 未対応環境はエラー
    if (md === undefined) {
      throw new DeviceUnavailableError("MediaDevices API is not available", {
        reason: "MEDIA_DEVICES_UNAVAILABLE",
      });
    }
    return md;
  }

  // navigator.permissions（W3C Permissions API。未対応環境では undefined を返す）
  function getPermissionsApi(): PermissionsLike | undefined {
    return (globalThis as { navigator?: { permissions?: PermissionsLike } }).navigator?.permissions;
  }

  // PermissionsAPI の state を PermissionStatus に正規化
  function mapPermissionState(value: string): PermissionStatus {
    // granted は granted
    if (value === "granted") {
      return "granted";
    }
    // denied は基本 blocked 扱い（Web では再 prompt 不可）
    if (value === "denied") {
      return "blocked";
    }
    // prompt 状態
    if (value === "prompt") {
      return "prompt";
    }
    // 未知値は unavailable 扱い
    return "unavailable";
  }

  // PreviewConfig を constraints に変換
  function toConstraints(config: PreviewConfig): { audio: boolean; video: Record<string, unknown> } {
    // video 部分のオプション組み立て
    const video: Record<string, unknown> = {};
    // deviceId が指定されていれば exact マッチで要求
    if (config.deviceId !== undefined) {
      video.deviceId = { exact: config.deviceId };
    } else if (config.facing !== undefined) {
      // facing を mediaTrack の facingMode にマップ
      const mode = config.facing === "front" ? "user" : config.facing === "back" ? "environment" : "user";
      video.facingMode = mode;
    }
    // 解像度ヒント
    if (config.resolution !== undefined) {
      video.width = { ideal: config.resolution.width };
      video.height = { ideal: config.resolution.height };
    }
    // fps
    if (config.frameRate !== undefined) {
      video.frameRate = { ideal: config.frameRate };
    }
    // 音声有無（既定 false）
    const audio = config.audio === true;
    return { audio, video };
  }

  // PermissionDescriptor を W3C name に変換（カメラ / マイクのみ対象）
  function descriptorTargets(descriptor: PermissionDescriptor): readonly string[] {
    // 配列で評価対象を返す
    const result: string[] = [];
    if (descriptor.camera) {
      result.push("camera");
    }
    if (descriptor.microphone === true) {
      result.push("microphone");
    }
    return result;
  }

  // 権限の照会（Permissions API があれば query、無ければ unavailable）
  async function getPermission(descriptor: PermissionDescriptor): Promise<PermissionStatus> {
    const permissions = getPermissionsApi();
    // Permissions API 自体が無い場合は unavailable
    if (permissions === undefined) {
      return "unavailable";
    }
    // 対象が空（camera:false など）なら granted 扱い
    const targets = descriptorTargets(descriptor);
    if (targets.length === 0) {
      return "granted";
    }
    // 各 target の query 結果を集約（最も restrictive な値を返す）
    const states: PermissionStatus[] = [];
    for (const name of targets) {
      try {
        const r = await permissions.query({ name });
        states.push(mapPermissionState(r.state));
      } catch {
        // query 失敗（未対応 name など）は unavailable 扱い
        states.push("unavailable");
      }
    }
    // 優先順: unavailable > blocked > denied > prompt > granted
    const priority: Record<PermissionStatus, number> = {
      unavailable: 4,
      blocked: 3,
      denied: 2,
      prompt: 1,
      granted: 0,
    };
    let worst: PermissionStatus = "granted";
    for (const s of states) {
      if (priority[s] > priority[worst]) {
        worst = s;
      }
    }
    return worst;
  }

  // 権限要求（Web は getUserMedia を成功させることが要求と同義）
  async function requestPermission(descriptor: PermissionDescriptor): Promise<PermissionStatus> {
    // camera 要求が無いなら何もしない
    if (!descriptor.camera) {
      return "granted";
    }
    const md = getMediaDevices();
    // getUserMedia を最小の constraints で呼んで success なら granted
    try {
      const stream = await md.getUserMedia({
        audio: descriptor.microphone === true,
        video: true,
      });
      // 即時 stop（権限取得が目的、stream は破棄）
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return "granted";
    } catch (err) {
      // 投げてきた DOMException の name で判定
      const errLike = err as { name?: string };
      // NotAllowedError は denied
      if (errLike.name === "NotAllowedError") {
        // Web は基本 blocked 扱いだが、core 側で勝手に判定するため denied を返す
        throw new PermissionDeniedError(descriptor, { cause: err });
      }
      // それ以外は DeviceUnavailableError
      throw new DeviceUnavailableError("Failed to acquire camera stream", { cause: err });
    }
  }

  // デバイス列挙
  async function listDevices(): Promise<readonly CameraDevice[]> {
    const md = getMediaDevices();
    // enumerateDevices 呼び出し
    const all = await md.enumerateDevices();
    // videoinput のみ抽出
    return all
      .filter((d) => d.kind === "videoinput")
      .map((d) => ({
        // deviceId をそのまま採用
        id: d.deviceId,
        // ラベルが空なら deviceId を流用
        label: d.label !== undefined && d.label.length > 0 ? d.label : d.deviceId,
      }));
  }

  // プレビュー開始
  async function startPreview(config: PreviewConfig): Promise<PreviewHandle> {
    const md = getMediaDevices();
    // constraints へ変換
    const constraints = toConstraints(config);
    // getUserMedia
    let stream: MediaStreamLike;
    try {
      stream = await md.getUserMedia(constraints);
    } catch (err) {
      const errLike = err as { name?: string };
      // 拒否系
      if (errLike.name === "NotAllowedError") {
        throw new PermissionDeniedError(
          { camera: true, microphone: constraints.audio === true },
          { cause: err },
        );
      }
      // それ以外
      throw new DeviceUnavailableError("Failed to start camera preview", { cause: err });
    }
    // target に video 要素が渡されていれば srcObject に attach（試行）
    let videoElement: HTMLVideoElement | undefined;
    if (
      config.target !== undefined &&
      typeof (config.target as { play?: unknown }).play === "function"
    ) {
      videoElement = config.target as HTMLVideoElement;
      // srcObject に MediaStream を設定（attach は失敗しても致命ではない）
      try {
        (videoElement as unknown as { srcObject: MediaStreamLike }).srcObject = stream;
        // 再生開始（autoplay 不要にする）
        await videoElement.play();
      } catch {
        // play 失敗は無視（呼出側が手動 play する想定）
      }
    }
    // ハンドル組み立て
    const handle: PreviewHandle = {
      __brand: "PreviewHandle",
      id: idFactory(),
      native: { stream, videoElement, audio: constraints.audio === true } satisfies PreviewNative,
    };
    // 内部 state に保存
    state.preview = { handle, native: handle.native as PreviewNative };
    return handle;
  }

  // プレビュー停止
  async function stopPreview(handle: PreviewHandle): Promise<void> {
    // state と一致するハンドルでなければ no-op（古いハンドルへの stop）
    if (state.preview === undefined || state.preview.handle.id !== handle.id) {
      return;
    }
    const native = state.preview.native;
    // 取り出して参照クリア
    state.preview = undefined;
    // 全 track を停止
    for (const track of native.stream.getTracks()) {
      track.stop();
    }
    // video.srcObject をクリア（GC に任せる）
    if (native.videoElement !== undefined) {
      try {
        (native.videoElement as unknown as { srcObject: MediaStreamLike | null }).srcObject = null;
      } catch {
        // setter throw は無視
      }
    }
  }

  // 静止画キャプチャ（canvas で描画して toBlob / toDataURL）
  async function takePicture(
    handle: PreviewHandle,
    pOptions: PhotoOptions = {},
  ): Promise<PhotoResult> {
    // ハンドル整合性チェック
    if (state.preview === undefined || state.preview.handle.id !== handle.id) {
      throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
    }
    const native = state.preview.native;
    // video 要素を取り出し（target 未指定なら一時要素を作る）
    const sourceVideo = native.videoElement ?? createOffscreenVideo(native.stream);
    // 動的に幅高さを参照（読めなければ 640x480 既定）
    const width =
      (sourceVideo as unknown as { videoWidth?: number }).videoWidth ?? 640;
    const height =
      (sourceVideo as unknown as { videoHeight?: number }).videoHeight ?? 480;
    // canvas を生成
    const document = (globalThis as { document?: Document }).document;
    if (document === undefined) {
      throw new CameraError("document is not available", { code: "DOCUMENT_UNAVAILABLE" });
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    // 2D コンテキストを取得
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new CameraError("2D canvas context is not available", { code: "CANVAS_UNAVAILABLE" });
    }
    // フレームを描画
    ctx.drawImage(sourceVideo, 0, 0, width, height);
    // MIME を決定
    const mimeType = pOptions.mimeType ?? "image/jpeg";
    // Blob 生成（toBlob は callback API なので Promise でラップ）
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (b) => resolve(b),
        mimeType,
        pOptions.quality,
      );
    });
    // null になったら撮影失敗
    if (blob === null) {
      throw new CameraError("Failed to encode captured frame", { code: "ENCODE_FAILED" });
    }
    // PhotoResult を返す
    return {
      id: idFactory(),
      media: { kind: "blob", blob, mimeType },
      width,
      height,
      capturedAt: now(),
    };
  }

  // 一時 video 要素を作る（target 未指定の takePicture 用）
  function createOffscreenVideo(stream: MediaStreamLike): HTMLVideoElement {
    const document = (globalThis as { document?: Document }).document;
    if (document === undefined) {
      throw new CameraError("document is not available", { code: "DOCUMENT_UNAVAILABLE" });
    }
    const v = document.createElement("video");
    (v as unknown as { srcObject: MediaStreamLike }).srcObject = stream;
    return v;
  }

  // 録画開始
  async function startRecording(
    handle: PreviewHandle,
    rOptions: RecordingOptions = {},
  ): Promise<RecordingHandle> {
    // ハンドル整合性
    if (state.preview === undefined || state.preview.handle.id !== handle.id) {
      throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
    }
    // MediaRecorder を取得（DOM 型と構造的に互換でない場合があるため unknown 経由でキャスト）
    const MediaRecorderCtorRef = (globalThis as unknown as { MediaRecorder?: MediaRecorderCtor })
      .MediaRecorder;
    if (MediaRecorderCtorRef === undefined) {
      throw new RecordingError("UNSUPPORTED", {
        message: "MediaRecorder is not supported in this environment",
      });
    }
    // MIME のサポートチェック
    const staticPart = (globalThis as unknown as { MediaRecorder?: MediaRecorderStatic })
      .MediaRecorder;
    const mimeType = rOptions.mimeType;
    if (
      mimeType !== undefined &&
      staticPart?.isTypeSupported !== undefined &&
      !staticPart.isTypeSupported(mimeType)
    ) {
      throw new RecordingError("UNSUPPORTED_MIME", {
        message: `MIME ${mimeType} is not supported by MediaRecorder`,
      });
    }
    // 録画 native の初期化
    const recorder = new MediaRecorderCtorRef(state.preview.native.stream, {
      mimeType: rOptions.mimeType,
      videoBitsPerSecond: rOptions.videoBitsPerSecond,
    });
    const recordingNative: RecordingNative = {
      recorder,
      chunks: [],
      // 明示指定 > recorder の自己申告 > 既定（"" 等の空文字は既定にフォールバック）
      mimeType: mimeType ?? (recorder.mimeType !== undefined && recorder.mimeType.length > 0 ? recorder.mimeType : "video/webm"),
      startedAt: now(),
      stopResolve: null,
      stopReject: null,
    };
    // ondataavailable で chunks へ
    recorder.ondataavailable = (event) => {
      // 空でなければ蓄積（空配信は実環境では極稀だが防御的に弾く）
      /* v8 ignore next */
      if (event.data !== undefined && event.data.size > 0) {
        recordingNative.chunks.push(event.data);
      }
    };
    // onstop で Blob を組み立てて resolve
    recorder.onstop = () => {
      // 連結 Blob
      const blob = new Blob(recordingNative.chunks, { type: recordingNative.mimeType });
      // result を作る
      const result: RecordingResult = {
        id: handle.id, // tmp、すぐに上書きする
        media: { kind: "blob", blob, mimeType: recordingNative.mimeType },
        durationMs: now() - recordingNative.startedAt,
        sizeBytes: blob.size,
      };
      // resolver があれば解決
      if (recordingNative.stopResolve !== null) {
        recordingNative.stopResolve(result);
      }
    };
    // onerror で reject（stop 前に onerror が発火するケースは実環境では極稀だが防御的に許容）
    recorder.onerror = (event) => {
      /* v8 ignore next */
      if (recordingNative.stopReject !== null) {
        recordingNative.stopReject(
          new RecordingError("RECORDER_ERROR", { cause: event, message: "MediaRecorder error" }),
        );
      }
    };
    // 録画開始
    recorder.start();
    // ハンドル組み立て
    const recordingHandle: RecordingHandle = {
      __brand: "RecordingHandle",
      id: idFactory(),
      native: recordingNative,
    };
    // state に保持
    state.recording = { handle: recordingHandle, native: recordingNative };
    return recordingHandle;
  }

  // 録画停止
  async function stopRecording(recording: RecordingHandle): Promise<RecordingResult> {
    if (state.recording === undefined || state.recording.handle.id !== recording.id) {
      throw new RecordingError("NOT_RECORDING");
    }
    const native = state.recording.native;
    // 取り出して state クリア（onstop が後発でも参照は持たせる）
    state.recording = undefined;
    // Promise を仕込んでから stop を呼ぶ
    const result = await new Promise<RecordingResult>((resolve, reject) => {
      native.stopResolve = resolve;
      native.stopReject = reject;
      // stop を呼ぶ
      try {
        native.recorder.stop();
      } catch (err) {
        reject(new RecordingError("STOP_FAILED", { cause: err }));
      }
    });
    // 結果の id を録画ハンドル ID で固定
    return { ...result, id: recording.id };
  }

  // 一時停止
  async function pauseRecording(recording: RecordingHandle): Promise<void> {
    if (state.recording === undefined || state.recording.handle.id !== recording.id) {
      throw new RecordingError("NOT_RECORDING");
    }
    try {
      state.recording.native.recorder.pause();
    } catch (err) {
      throw new RecordingError("PAUSE_FAILED", { cause: err });
    }
  }

  // 再開
  async function resumeRecording(recording: RecordingHandle): Promise<void> {
    if (state.recording === undefined || state.recording.handle.id !== recording.id) {
      throw new RecordingError("NOT_RECORDING");
    }
    try {
      state.recording.native.recorder.resume();
    } catch (err) {
      throw new RecordingError("RESUME_FAILED", { cause: err });
    }
  }

  // バーコードスキャン
  async function scanBarcode(
    handle: PreviewHandle,
    config: ScannerConfig,
    onScan: (result: BarcodeScanResult) => void,
  ): Promise<() => void> {
    // ハンドル整合性
    if (state.preview === undefined || state.preview.handle.id !== handle.id) {
      throw new ScannerError("CAMERA_NOT_READY", { message: "Preview handle is not active" });
    }
    // 既にスキャナが動いていればエラー
    if (state.scannerCancel !== undefined) {
      throw new ScannerError("ALREADY_SCANNING");
    }
    // 検出対象 formats（既定 ["qr_code"]）
    const formats: readonly BarcodeFormat[] = config.formats ?? ["qr_code"];
    // BarcodeDetector を生成（失敗時は ScannerError）
    let detector;
    try {
      detector = barcodeDetectorFactory(formats);
    } catch (err) {
      throw new ScannerError("UNSUPPORTED_FORMAT", { cause: err });
    }
    // throttle 用直近結果
    let previous: { value: string; scannedAt: number } | undefined;
    // 取り消しフラグ
    let cancelled = false;
    // 次フレームのハンドル
    let scheduleHandle: unknown;
    // tick 関数
    const tick = async (): Promise<void> => {
      // 取消後は何もしない
      if (cancelled) {
        return;
      }
      // detect 対象の video 要素を取得
      const video = state.preview?.native.videoElement;
      // video が無い場合は次フレームへ
      if (video !== undefined) {
        try {
          const detections = await detector.detect(video);
          // 1 件ずつ評価
          for (const d of detections) {
            const scannedAt = now();
            // throttle 判定
            if (!shouldEmitScan({ value: d.rawValue, scannedAt }, previous, config.throttleMs ?? 0)) {
              continue;
            }
            previous = { value: d.rawValue, scannedAt };
            // format を string でそのまま採用（W3C の format は core の BarcodeFormat と一致）
            onScan({
              id: idFactory(),
              format: d.format as BarcodeFormat,
              value: d.rawValue,
              scannedAt,
              boundingBox: d.boundingBox,
            });
          }
        } catch {
          // detect 例外は 1 フレーム分だけ無視（次フレームで再試行）
        }
      }
      // 次フレームを予約
      if (!cancelled) {
        scheduleHandle = scheduler.schedule(() => {
          void tick();
        });
      }
    };
    // 開始
    scheduleHandle = scheduler.schedule(() => {
      void tick();
    });
    // 解除関数
    const cancel = (): void => {
      cancelled = true;
      if (scheduleHandle !== undefined) {
        scheduler.cancel(scheduleHandle);
        scheduleHandle = undefined;
      }
      state.scannerCancel = undefined;
    };
    state.scannerCancel = cancel;
    return cancel;
  }

  // プレビューのアクティブな video トラックを取り出す（無ければ CameraControlError）
  function requireVideoTrack(handle: PreviewHandle): MediaStreamTrackLike {
    // ハンドル整合性チェック
    if (state.preview === undefined || state.preview.handle.id !== handle.id) {
      throw new CameraError("Preview handle is not active", { code: "INVALID_HANDLE" });
    }
    // video トラックを探す
    const track = state.preview.native.stream.getTracks().find((t) => t.kind === "video");
    // 無い場合は制御不能とみなす
    if (track === undefined) {
      throw new CameraControlError("UNSUPPORTED", {
        message: "No video track is available on the current preview",
      });
    }
    return track;
  }

  // OverconstrainedError 名のエラーを CameraControlError("OUT_OF_RANGE") にラップ、それ以外は APPLY_FAILED
  function wrapApplyError(err: unknown): CameraControlError {
    // DOMException 系の name で分岐
    const errLike = err as { name?: string };
    // 範囲外指定は OUT_OF_RANGE として通知
    if (errLike.name === "OverconstrainedError") {
      return new CameraControlError("OUT_OF_RANGE", { cause: err });
    }
    // それ以外は適用失敗
    return new CameraControlError("APPLY_FAILED", { cause: err });
  }

  // トーチモード切替（applyConstraints で advanced 制約を渡す）
  async function setTorch(handle: PreviewHandle, mode: TorchMode): Promise<void> {
    // video トラックを取得
    const track = requireVideoTrack(handle);
    // applyConstraints 自体が無い環境は UNSUPPORTED
    if (track.applyConstraints === undefined) {
      throw new CameraControlError("UNSUPPORTED", {
        message: "applyConstraints is not supported on this MediaStreamTrack",
      });
    }
    // mode === "on" のみ true を送る
    try {
      await track.applyConstraints({ advanced: [{ torch: mode === "on" }] });
    } catch (err) {
      throw wrapApplyError(err);
    }
  }

  // ズーム倍率の設定
  async function setZoom(handle: PreviewHandle, zoom: number): Promise<void> {
    // video トラックを取得
    const track = requireVideoTrack(handle);
    // applyConstraints 未対応なら UNSUPPORTED
    if (track.applyConstraints === undefined) {
      throw new CameraControlError("UNSUPPORTED", {
        message: "applyConstraints is not supported on this MediaStreamTrack",
      });
    }
    // advanced 制約で zoom を送る
    try {
      await track.applyConstraints({ advanced: [{ zoom }] });
    } catch (err) {
      throw wrapApplyError(err);
    }
  }

  // フォーカス制御（point ありで manual、なしで continuous）
  async function setFocus(handle: PreviewHandle, point?: FocusPoint): Promise<void> {
    // video トラックを取得
    const track = requireVideoTrack(handle);
    // applyConstraints 未対応なら UNSUPPORTED
    if (track.applyConstraints === undefined) {
      throw new CameraControlError("UNSUPPORTED", {
        message: "applyConstraints is not supported on this MediaStreamTrack",
      });
    }
    // point 指定有無で manual / continuous を切り替える
    const constraint: Record<string, unknown> =
      point !== undefined
        ? { focusMode: "manual", pointsOfInterest: [{ x: point.x, y: point.y }] }
        : { focusMode: "continuous" };
    try {
      await track.applyConstraints({ advanced: [constraint] });
    } catch (err) {
      throw wrapApplyError(err);
    }
  }

  // 能力情報の取得（MediaTrackCapabilities を CameraCapabilities にマップ）
  async function getCapabilities(handle: PreviewHandle): Promise<CameraCapabilities> {
    // video トラックを取得
    const track = requireVideoTrack(handle);
    // getCapabilities 未対応なら全 false で返す
    if (track.getCapabilities === undefined) {
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
    // 生の能力情報を取得
    const caps = track.getCapabilities();
    // torch は boolean かもしれないし [true] のような配列で返る環境もあるため両対応で判定
    const torchSupported = caps.torch === true || (Array.isArray(caps.torch) && caps.torch.includes(true));
    // focusMode 一覧から tap / continuous を抽出
    const focusModes = caps.focusMode ?? [];
    const focus = focusModes.length > 0
      ? { tap: focusModes.includes("manual") || focusModes.includes("single-shot"), continuous: focusModes.includes("continuous") }
      : (false as const);
    // CameraCapabilities にマップ
    return {
      // torch サポート（applyConstraints の有無も考慮）
      torch: torchSupported && track.applyConstraints !== undefined,
      // ズーム range（min < max のときのみオブジェクト化）
      zoom: caps.zoom !== undefined ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step } : (false as const),
      // フォーカス能力
      focus,
      // フラッシュは Web 標準で別 API（ImageCapture.setOptions）が必要なため getCapabilities ではトーチと同義に揃える
      flash: torchSupported,
      // 露出モード一覧
      exposureMode: caps.exposureMode !== undefined && caps.exposureMode.length > 0 ? caps.exposureMode : (false as const),
      // ホワイトバランス一覧
      whiteBalanceMode: caps.whiteBalanceMode !== undefined && caps.whiteBalanceMode.length > 0 ? caps.whiteBalanceMode : (false as const),
      // ISO range
      iso: caps.iso !== undefined ? { min: caps.iso.min, max: caps.iso.max } : (false as const),
      // 明度 range
      brightness: caps.brightness !== undefined ? { min: caps.brightness.min, max: caps.brightness.max, step: caps.brightness.step } : (false as const),
      // HDR / 低照度ブーストは Web では標準 API 無し
      hdr: false,
      lowLightBoost: false,
    };
  }

  // dispose
  async function dispose(): Promise<void> {
    // スキャナを止める
    if (state.scannerCancel !== undefined) {
      state.scannerCancel();
    }
    // 録画を止める（結果は捨てる）
    if (state.recording !== undefined) {
      try {
        state.recording.native.recorder.stop();
      } catch {
        // 停止失敗は無視
      }
      state.recording = undefined;
    }
    // プレビューを止める
    if (state.preview !== undefined) {
      const native = state.preview.native;
      state.preview = undefined;
      for (const track of native.stream.getTracks()) {
        track.stop();
      }
    }
  }

  // CameraAdapter として返す
  return {
    id: "web",
    listDevices,
    getPermission,
    requestPermission,
    startPreview,
    stopPreview,
    takePicture,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    scanBarcode,
    setTorch,
    setZoom,
    setFocus,
    getCapabilities,
    dispose,
  };
}
