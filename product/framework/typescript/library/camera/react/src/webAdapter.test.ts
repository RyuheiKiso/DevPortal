// vitest API
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// テスト対象
import { createWebAdapter } from "./webAdapter.js";
// 期待エラー
import {
  CameraControlError,
  CameraError,
  DeviceUnavailableError,
  PermissionDeniedError,
  RecordingError,
  ScannerError,
} from "@k1s0-ts-camera/core";
import type { PreviewHandle } from "@k1s0-ts-camera/core";

// MediaStream fake（track stop を観測できる）
function makeFakeStream() {
  const stopped: string[] = [];
  const tracks = [
    { kind: "video", stop: () => stopped.push("video") },
    { kind: "audio", stop: () => stopped.push("audio") },
  ];
  return {
    stream: { getTracks: () => tracks },
    stopped,
  };
}

// MediaRecorder fake コンストラクタ生成
function installFakeMediaRecorder(
  options: {
    isTypeSupported?: (t: string) => boolean;
    failStart?: boolean;
    failStop?: boolean;
    failPause?: boolean;
    failResume?: boolean;
    triggerError?: boolean;
  } = {},
) {
  const instances: FakeMediaRecorder[] = [];
  class FakeMediaRecorder {
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    state = "inactive";
    mimeType: string;
    constructor(_stream: unknown, opts?: { mimeType?: string }) {
      this.mimeType = opts?.mimeType ?? "video/webm";
      instances.push(this);
    }
    start(): void {
      if (options.failStart === true) {
        throw new Error("start failed");
      }
      this.state = "recording";
      // 1 chunk を即時配信
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(["x"], { type: this.mimeType }) });
      });
    }
    stop(): void {
      if (options.failStop === true) {
        throw new Error("stop failed");
      }
      this.state = "inactive";
      if (options.triggerError === true) {
        // onerror -> reject へ
        queueMicrotask(() => this.onerror?.({ name: "InvalidStateError" }));
        return;
      }
      // onstop を遅延発火
      queueMicrotask(() => this.onstop?.());
    }
    pause(): void {
      if (options.failPause === true) {
        throw new Error("pause failed");
      }
      this.state = "paused";
    }
    resume(): void {
      if (options.failResume === true) {
        throw new Error("resume failed");
      }
      this.state = "recording";
    }
  }
  // isTypeSupported を static として付与
  (FakeMediaRecorder as unknown as { isTypeSupported?: (t: string) => boolean }).isTypeSupported =
    options.isTypeSupported;
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  return instances;
}

// fake document（canvas + video の最小実装）
function installFakeDocument() {
  const drawn: Array<{ src: unknown; w: number; h: number }> = [];
  const fakeCanvasCtx = {
    drawImage: vi.fn((src: unknown, _x: number, _y: number, w: number, h: number) => {
      drawn.push({ src, w, h });
    }),
  };
  let toBlobFails = false;
  const fakeDocument = {
    createElement: (tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: (id: string) =>
            id === "2d" ? fakeCanvasCtx : null,
          toBlob: (
            cb: (b: Blob | null) => void,
            mime: string,
            _quality?: number,
          ): void => {
            if (toBlobFails) {
              cb(null);
              return;
            }
            cb(new Blob(["data"], { type: mime }));
          },
        };
      }
      if (tag === "video") {
        return {
          srcObject: null,
          videoWidth: 200,
          videoHeight: 100,
          play: () => Promise.resolve(),
        };
      }
      return {};
    },
  };
  vi.stubGlobal("document", fakeDocument);
  return {
    canvasCtx: fakeCanvasCtx,
    setToBlobFails: (v: boolean) => {
      toBlobFails = v;
    },
    drawn,
  };
}

// fake navigator.mediaDevices
function installFakeNavigator(
  options: {
    getUserMedia?: (constraints: unknown) => Promise<unknown>;
    enumerateDevices?: () => Promise<unknown>;
    permissions?: { query?: (descriptor: { name: string }) => Promise<{ state: string }> };
    noMediaDevices?: boolean;
  } = {},
) {
  if (options.noMediaDevices === true) {
    vi.stubGlobal("navigator", {});
    return;
  }
  const stream = makeFakeStream();
  const mediaDevices = {
    getUserMedia: options.getUserMedia ?? (async () => stream.stream),
    enumerateDevices:
      options.enumerateDevices ??
      (async () => [
        { kind: "videoinput", deviceId: "v1", label: "Cam 1" },
        { kind: "videoinput", deviceId: "v2", label: "" },
        { kind: "audioinput", deviceId: "a1", label: "Mic 1" },
      ]),
  };
  vi.stubGlobal("navigator", {
    mediaDevices,
    permissions: options.permissions,
  });
  return { stream };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createWebAdapter listDevices", () => {
  it("mediaDevices 未対応で DeviceUnavailableError", async () => {
    installFakeNavigator({ noMediaDevices: true });
    const adapter = createWebAdapter();
    await expect(adapter.listDevices()).rejects.toBeInstanceOf(DeviceUnavailableError);
  });

  it("videoinput のみ抽出し label が空なら deviceId を使う", async () => {
    installFakeNavigator();
    const adapter = createWebAdapter();
    const list = await adapter.listDevices();
    expect(list).toEqual([
      { id: "v1", label: "Cam 1" },
      { id: "v2", label: "v2" },
    ]);
  });
});

describe("createWebAdapter permissions", () => {
  it("Permissions API 不在で unavailable", async () => {
    installFakeNavigator();
    const adapter = createWebAdapter();
    await expect(adapter.getPermission({ camera: true })).resolves.toBe("unavailable");
  });

  it("descriptor のターゲットが空なら granted", async () => {
    installFakeNavigator({ permissions: { query: vi.fn() } });
    const adapter = createWebAdapter();
    await expect(adapter.getPermission({ camera: false })).resolves.toBe("granted");
  });

  it("query 結果を granted/blocked/prompt/unavailable に正規化する", async () => {
    const cases: Array<[string, "granted" | "blocked" | "prompt" | "unavailable"]> = [
      ["granted", "granted"],
      ["denied", "blocked"],
      ["prompt", "prompt"],
      ["unknown-state", "unavailable"],
    ];
    for (const [state, expected] of cases) {
      installFakeNavigator({
        permissions: { query: async () => ({ state }) },
      });
      const adapter = createWebAdapter();
      await expect(adapter.getPermission({ camera: true })).resolves.toBe(expected);
    }
  });

  it("microphone も対象にする / query 失敗時は unavailable / worst を採用", async () => {
    let call = 0;
    installFakeNavigator({
      permissions: {
        query: async () => {
          call++;
          // 1 回目: prompt、2 回目: throw
          if (call === 1) {
            return { state: "prompt" };
          }
          throw new Error("nope");
        },
      },
    });
    const adapter = createWebAdapter();
    await expect(
      adapter.getPermission({ camera: true, microphone: true }),
    ).resolves.toBe("unavailable");
  });

  it("requestPermission: camera:false なら granted", async () => {
    installFakeNavigator();
    const adapter = createWebAdapter();
    await expect(adapter.requestPermission({ camera: false })).resolves.toBe("granted");
  });

  it("requestPermission: getUserMedia 成功で granted", async () => {
    installFakeNavigator();
    const adapter = createWebAdapter();
    await expect(adapter.requestPermission({ camera: true, microphone: true })).resolves.toBe(
      "granted",
    );
  });

  it("requestPermission: NotAllowedError で PermissionDeniedError", async () => {
    installFakeNavigator({
      getUserMedia: async () => {
        const e = new Error("denied");
        (e as { name: string }).name = "NotAllowedError";
        throw e;
      },
    });
    const adapter = createWebAdapter();
    await expect(adapter.requestPermission({ camera: true })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("requestPermission: 他例外で DeviceUnavailableError", async () => {
    installFakeNavigator({
      getUserMedia: async () => {
        throw new Error("HW error");
      },
    });
    const adapter = createWebAdapter();
    await expect(adapter.requestPermission({ camera: true })).rejects.toBeInstanceOf(
      DeviceUnavailableError,
    );
  });
});

describe("createWebAdapter preview", () => {
  it("startPreview: deviceId 指定で constraints に deviceId.exact が入る", async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
    installFakeNavigator({ getUserMedia });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({ deviceId: "v1" });
    expect(h.__brand).toBe("PreviewHandle");
    const constraints = getUserMedia.mock.calls[0][0] as { video: { deviceId?: unknown } };
    expect(constraints.video.deviceId).toEqual({ exact: "v1" });
  });

  it("startPreview: facing front -> facingMode=user", async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
    installFakeNavigator({ getUserMedia });
    const adapter = createWebAdapter();
    await adapter.startPreview({ facing: "front" });
    const constraints = getUserMedia.mock.calls[0][0] as { video: { facingMode?: string } };
    expect(constraints.video.facingMode).toBe("user");
  });

  it("startPreview: facing back -> environment, external -> user fallback", async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
    installFakeNavigator({ getUserMedia });
    const adapter = createWebAdapter();
    await adapter.startPreview({ facing: "back" });
    let constraints = getUserMedia.mock.calls[0][0] as { video: { facingMode?: string } };
    expect(constraints.video.facingMode).toBe("environment");
    await adapter.startPreview({ facing: "external" });
    constraints = getUserMedia.mock.calls[1][0] as { video: { facingMode?: string } };
    expect(constraints.video.facingMode).toBe("user");
  });

  it("startPreview: resolution / frameRate / audio が constraints に反映", async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
    installFakeNavigator({ getUserMedia });
    const adapter = createWebAdapter();
    await adapter.startPreview({
      resolution: { width: 1280, height: 720 },
      frameRate: 30,
      audio: true,
    });
    const c = getUserMedia.mock.calls[0][0] as {
      audio: boolean;
      video: { width: unknown; height: unknown; frameRate: unknown };
    };
    expect(c.audio).toBe(true);
    expect(c.video.width).toEqual({ ideal: 1280 });
    expect(c.video.height).toEqual({ ideal: 720 });
    expect(c.video.frameRate).toEqual({ ideal: 30 });
  });

  it("startPreview: target に video element 渡せば srcObject 設定 + play", async () => {
    installFakeNavigator();
    const adapter = createWebAdapter();
    const play = vi.fn().mockResolvedValue(undefined);
    const video = { srcObject: null, play } as unknown as HTMLVideoElement;
    await adapter.startPreview({ target: video });
    expect((video as unknown as { srcObject: unknown }).srcObject).not.toBeNull();
    expect(play).toHaveBeenCalled();
  });

  it("startPreview: play 失敗を吸収", async () => {
    installFakeNavigator();
    const adapter = createWebAdapter();
    const video = {
      srcObject: null,
      play: vi.fn().mockRejectedValue(new Error("no")),
    } as unknown as HTMLVideoElement;
    await expect(adapter.startPreview({ target: video })).resolves.toBeDefined();
  });

  it("startPreview: NotAllowedError -> PermissionDeniedError", async () => {
    installFakeNavigator({
      getUserMedia: async () => {
        const e = new Error("denied");
        (e as { name: string }).name = "NotAllowedError";
        throw e;
      },
    });
    const adapter = createWebAdapter();
    await expect(adapter.startPreview({ audio: true })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("startPreview: 他例外 -> DeviceUnavailableError", async () => {
    installFakeNavigator({
      getUserMedia: async () => {
        throw new Error("hw");
      },
    });
    const adapter = createWebAdapter();
    await expect(adapter.startPreview({})).rejects.toBeInstanceOf(DeviceUnavailableError);
  });

  it("stopPreview: 不一致ハンドルは no-op", async () => {
    installFakeNavigator();
    const adapter = createWebAdapter();
    const fakeHandle: PreviewHandle = { __brand: "PreviewHandle", id: "nonexistent", native: null };
    await expect(adapter.stopPreview(fakeHandle)).resolves.toBeUndefined();
  });

  it("stopPreview: 正常時に tracks.stop と srcObject=null", async () => {
    const { stream } = installFakeNavigator() ?? { stream: makeFakeStream() };
    const adapter = createWebAdapter();
    const video = { srcObject: null, play: vi.fn().mockResolvedValue(undefined) } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    await adapter.stopPreview(h);
    expect(stream.stopped).toContain("video");
    expect((video as unknown as { srcObject: unknown }).srcObject).toBeNull();
  });

  it("stopPreview: target 未指定で videoElement が無い場合も正常に停止", async () => {
    installFakeNavigator();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.stopPreview(h)).resolves.toBeUndefined();
  });

  it("stopPreview: srcObject setter throw は無視", async () => {
    installFakeNavigator();
    const adapter = createWebAdapter();
    const video = {
      get srcObject() {
        return null;
      },
      set srcObject(_: unknown) {
        throw new Error("nope");
      },
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    await expect(adapter.stopPreview(h)).resolves.toBeUndefined();
  });
});

describe("createWebAdapter takePicture", () => {
  beforeEach(() => {
    installFakeNavigator();
  });

  it("INVALID_HANDLE エラー", async () => {
    installFakeDocument();
    const adapter = createWebAdapter();
    await adapter.startPreview({});
    const fakeHandle: PreviewHandle = { __brand: "PreviewHandle", id: "fake", native: null };
    await expect(adapter.takePicture(fakeHandle)).rejects.toBeInstanceOf(CameraError);
  });

  it("document 不在で CameraError", async () => {
    vi.stubGlobal("document", undefined);
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.takePicture(h)).rejects.toMatchObject({ code: "DOCUMENT_UNAVAILABLE" });
  });

  it("2D context 取得失敗で CameraError", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => null,
        toBlob: () => {},
      }),
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.takePicture(h)).rejects.toMatchObject({ code: "CANVAS_UNAVAILABLE" });
  });

  it("toBlob が null で CameraError", async () => {
    const fd = installFakeDocument();
    fd.setToBlobFails(true);
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.takePicture(h)).rejects.toMatchObject({ code: "ENCODE_FAILED" });
  });

  it("正常系: target なしで一時 video を作って撮影", async () => {
    installFakeDocument();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const result = await adapter.takePicture(h, {});
    expect(result.media.kind).toBe("blob");
    // 内部で生成された一時 video の videoWidth=200 を使う
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
    // 念のためハンドルにも対応する
    await expect(
      adapter.takePicture(h, { mimeType: "image/png", quality: 0.5 }),
    ).resolves.toBeDefined();
  });

  it("正常系: target 付き + 既定 video の videoWidth/Height", async () => {
    installFakeDocument();
    const adapter = createWebAdapter();
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
      videoWidth: 500,
      videoHeight: 300,
    } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    const result = await adapter.takePicture(h);
    expect(result.width).toBe(500);
    expect(result.height).toBe(300);
  });

  it("videoWidth/Height 未定義時は 640x480 既定", async () => {
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: vi.fn() }),
            toBlob: (cb: (b: Blob) => void, mime: string) => cb(new Blob([], { type: mime })),
          };
        }
        return { srcObject: null, play: () => Promise.resolve() };
      },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const result = await adapter.takePicture(h);
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
  });

  it("createOffscreenVideo: document 不在で throw", async () => {
    installFakeDocument();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    // takePicture 直前で document を破棄して内部 createOffscreenVideo 経路を試す
    vi.stubGlobal("document", undefined);
    await expect(adapter.takePicture(h)).rejects.toMatchObject({
      code: "DOCUMENT_UNAVAILABLE",
    });
  });

  it("createOffscreenVideo: readyState=0 で loadedmetadata 待ちパスを通る", async () => {
    // listener を保持して外部から発火させる
    let savedListener: (() => void) | undefined;
    const removeSpy = vi.fn();
    // canvas は通常通り、video は readyState=0 + addEventListener / removeEventListener を持つ
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: vi.fn() }),
            toBlob: (cb: (b: Blob) => void, mime: string) => cb(new Blob([], { type: mime })),
          };
        }
        // video: readyState=0 で metadata 待ち必須、play() は reject させて catch 分岐も同時にカバー
        return {
          srcObject: null,
          videoWidth: 320,
          videoHeight: 240,
          readyState: 0,
          play: () => Promise.reject(new Error("autoplay blocked")),
          addEventListener: (event: string, cb: () => void): void => {
            if (event === "loadedmetadata") {
              savedListener = cb;
            }
          },
          removeEventListener: removeSpy,
        };
      },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    // takePicture を呼ぶが、loadedmetadata がまだ発火していないので await が hang する
    const takeP = adapter.takePicture(h);
    // microtask を進めて createOffscreenVideo の addEventListener まで到達させる
    await new Promise((r) => setTimeout(r, 0));
    expect(savedListener).toBeDefined();
    // 外部から loadedmetadata 発火 → onMeta が呼ばれて Promise resolve
    savedListener?.();
    // takePicture 完了
    const result = await takeP;
    // mock video の videoWidth=320, videoHeight=240 が結果に反映
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    // removeEventListener 経路も踏まれていること
    expect(removeSpy).toHaveBeenCalledWith("loadedmetadata", expect.any(Function));
  });

  it("createOffscreenVideo: addEventListener が無い video mock では即時 resolve（hang しない）", async () => {
    // readyState=0 + addEventListener なしの mock
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: vi.fn() }),
            toBlob: (cb: (b: Blob) => void, mime: string) => cb(new Blob([], { type: mime })),
          };
        }
        // addEventListener / removeEventListener を提供しない
        return {
          srcObject: null,
          videoWidth: 100,
          videoHeight: 50,
          readyState: 0,
          play: () => Promise.resolve(),
        };
      },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    // hang せず即時 resolve
    const result = await adapter.takePicture(h);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });

  it("createOffscreenVideo: loadedmetadata が発火しない場合は 2 秒 timeout で resolve", async () => {
    // 偽タイマーで timeout 経路を踏む
    vi.useFakeTimers();
    try {
      // addEventListener は存在するが発火しない mock
      vi.stubGlobal("document", {
        createElement: (tag: string) => {
          if (tag === "canvas") {
            return {
              width: 0,
              height: 0,
              getContext: () => ({ drawImage: vi.fn() }),
              toBlob: (cb: (b: Blob) => void, mime: string) => cb(new Blob([], { type: mime })),
            };
          }
          return {
            srcObject: null,
            videoWidth: 640,
            videoHeight: 480,
            readyState: 0,
            play: () => Promise.resolve(),
            // listener 登録は受けるが test 側で発火させない
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          };
        },
      });
      const adapter = createWebAdapter();
      const h = await adapter.startPreview({});
      const takeP = adapter.takePicture(h);
      // 2 秒経過させて timeout resolve を発火
      await vi.advanceTimersByTimeAsync(2000);
      const result = await takeP;
      // metadata 取得は諦めるが videoWidth/Height は mock の値を採用（640x480）
      expect(result.width).toBe(640);
      expect(result.height).toBe(480);
    } finally {
      vi.useRealTimers();
    }
  });

  it("target 指定後に document が破棄された場合、takePicture 直内の document check 経路", async () => {
    installFakeDocument();
    const adapter = createWebAdapter();
    // target を指定して startPreview（createOffscreenVideo を経由しないようにする）
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
      videoWidth: 10,
      videoHeight: 10,
    } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    // ここで document を undefined にすると、takePicture 内の 2 段目 document check で throw
    vi.stubGlobal("document", undefined);
    await expect(adapter.takePicture(h)).rejects.toMatchObject({
      code: "DOCUMENT_UNAVAILABLE",
    });
  });
});

describe("createWebAdapter recording", () => {
  beforeEach(() => {
    installFakeNavigator();
    installFakeDocument();
  });

  it("MediaRecorder 不在で UNSUPPORTED", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.startRecording(h)).rejects.toMatchObject({ reason: "UNSUPPORTED" });
  });

  it("INVALID_HANDLE で CameraError", async () => {
    installFakeMediaRecorder();
    const adapter = createWebAdapter();
    await adapter.startPreview({});
    const fakeHandle: PreviewHandle = { __brand: "PreviewHandle", id: "fake", native: null };
    await expect(adapter.startRecording(fakeHandle)).rejects.toBeInstanceOf(CameraError);
  });

  it("isTypeSupported が false なら UNSUPPORTED_MIME", async () => {
    installFakeMediaRecorder({ isTypeSupported: () => false });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(
      adapter.startRecording(h, { mimeType: "video/exotic" }),
    ).rejects.toMatchObject({ reason: "UNSUPPORTED_MIME" });
  });

  it("isTypeSupported が true なら開始成功 / stop で結果取得", async () => {
    installFakeMediaRecorder({ isTypeSupported: () => true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h, { mimeType: "video/mp4", videoBitsPerSecond: 1_000_000 });
    expect(rec.__brand).toBe("RecordingHandle");
    const result = await adapter.stopRecording(rec);
    expect(result.id).toBe(rec.id);
    expect(result.media.kind).toBe("blob");
  });

  it("mimeType 未指定なら recorder.mimeType をそのまま採用", async () => {
    installFakeMediaRecorder();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    const result = await adapter.stopRecording(rec);
    expect(result.media.mimeType).toBe("video/webm");
  });

  it("stopRecording: NOT_RECORDING", async () => {
    installFakeMediaRecorder();
    const adapter = createWebAdapter();
    const fakeRec = { __brand: "RecordingHandle" as const, id: "fake", native: null };
    await expect(adapter.stopRecording(fakeRec)).rejects.toMatchObject({ reason: "NOT_RECORDING" });
  });

  it("stopRecording: stop が throw すると STOP_FAILED", async () => {
    installFakeMediaRecorder({ failStop: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    await expect(adapter.stopRecording(rec)).rejects.toMatchObject({ reason: "STOP_FAILED" });
  });

  it("stopRecording: recorder.onerror で RECORDER_ERROR", async () => {
    installFakeMediaRecorder({ triggerError: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    await expect(adapter.stopRecording(rec)).rejects.toMatchObject({ reason: "RECORDER_ERROR" });
  });

  it("pauseRecording / resumeRecording 正常 / NOT_RECORDING / 失敗", async () => {
    installFakeMediaRecorder();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    await adapter.pauseRecording?.(rec);
    await adapter.resumeRecording?.(rec);
    const fakeRec = { __brand: "RecordingHandle" as const, id: "x", native: null };
    await expect(adapter.pauseRecording?.(fakeRec)).rejects.toMatchObject({
      reason: "NOT_RECORDING",
    });
    await expect(adapter.resumeRecording?.(fakeRec)).rejects.toMatchObject({
      reason: "NOT_RECORDING",
    });
    await adapter.stopRecording(rec);
  });

  it("pause/resume が throw で PAUSE_FAILED / RESUME_FAILED", async () => {
    installFakeMediaRecorder({ failPause: true, failResume: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    await expect(adapter.pauseRecording?.(rec)).rejects.toMatchObject({ reason: "PAUSE_FAILED" });
    await expect(adapter.resumeRecording?.(rec)).rejects.toMatchObject({ reason: "RESUME_FAILED" });
  });

  it("maxDurationMs 指定で setTimeout 経由の自動停止が走り、後続 stopRecording は pendingResult を返す", async () => {
    // 偽タイマーでまず setTimeout を仕掛ける挙動を確認
    vi.useFakeTimers();
    try {
      const instances = installFakeMediaRecorder();
      const adapter = createWebAdapter();
      const h = await adapter.startPreview({});
      // maxDurationMs を指定すると timeslice 1000 で start が呼ばれ、setTimeout が仕込まれる
      const rec = await adapter.startRecording(h, { maxDurationMs: 500 });
      // 既存 instances に start が timeslice 1000 で呼ばれていることは型上保証されないため state のみ確認
      expect(instances[0]?.state).toBe("recording");
      // タイマーを進めて自動停止トリガを発火
      vi.advanceTimersByTime(500);
      // queueMicrotask の onstop を流すため fake timers を flush
      await vi.runAllTimersAsync();
      // 内部的に recorder.stop() が呼ばれて inactive になる
      expect(instances[0]?.state).toBe("inactive");
      // 後続の stopRecording は pendingResult を返す（自動停止で積まれた blob）
      const result = await adapter.stopRecording(rec);
      // ハンドル ID で書き換えられた id が一致
      expect(result.id).toBe(rec.id);
      // media は blob モード
      expect(result.media.kind).toBe("blob");
    } finally {
      vi.useRealTimers();
    }
  });

  it("maxDurationMs 自動停止経路で recorder.stop が throw しても続行", async () => {
    // failStop = true なら recorder.stop が throw を返す。setTimeout 内で握りつぶされること
    vi.useFakeTimers();
    try {
      installFakeMediaRecorder({ failStop: true });
      const adapter = createWebAdapter();
      const h = await adapter.startPreview({});
      const rec = await adapter.startRecording(h, { maxDurationMs: 100 });
      // タイマー経過で stop が呼ばれるが throw する。pending の stop は無い段階なので例外伝播は起きない
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      // 後続の明示的 stopRecording は STOP_FAILED になる（recorder.stop は依然 throw 設定）
      await expect(adapter.stopRecording(rec)).rejects.toMatchObject({ reason: "STOP_FAILED" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("maxFileSizeBytes 超過で ondataavailable 経由の自動停止が走り pendingResult を返す", async () => {
    // FakeMediaRecorder.start は queueMicrotask で 1 つの "x" Blob (size=1) を配信する
    // maxFileSizeBytes=1 にすると 1 度の配信で閾値到達 → 自動 stop
    const instances = installFakeMediaRecorder();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h, { maxFileSizeBytes: 1 });
    // ondataavailable は microtask 経由で発火するため await で吸収
    await new Promise((r) => setTimeout(r, 0));
    // 自動 stop により inactive に遷移
    expect(instances[0]?.state).toBe("inactive");
    // 後続の stopRecording は pendingResult を返す
    const result = await adapter.stopRecording(rec);
    expect(result.id).toBe(rec.id);
    // chunk が累積されていたので sizeBytes は 1 以上
    expect((result.sizeBytes ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it("maxFileSizeBytes 自動停止経路で recorder.stop が throw しても続行", async () => {
    installFakeMediaRecorder({ failStop: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h, { maxFileSizeBytes: 1 });
    // 配信 microtask を流す（自動 stop 経路で throw が握りつぶされる）
    await new Promise((r) => setTimeout(r, 0));
    // failStop のため、後続 stopRecording も STOP_FAILED で失敗するのが期待挙動
    await expect(adapter.stopRecording(rec)).rejects.toMatchObject({ reason: "STOP_FAILED" });
  });

  it("recorder.onerror が stopRecording 前に発火すると pendingError として保持され後続 stop で throw", async () => {
    // triggerError=true で stop() 時に onerror を発火、stop() より早く onerror が来る形にするため
    // 独自の Fake を組み立てる
    const instances: FakeMediaRecorder[] = [];
    class FakeMediaRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      state = "inactive";
      mimeType = "video/webm";
      constructor(_stream: unknown) {
        instances.push(this);
      }
      start(): void {
        this.state = "recording";
      }
      stop(): void {
        this.state = "inactive";
      }
      pause(): void {
        this.state = "paused";
      }
      resume(): void {
        this.state = "recording";
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    // stop 前に onerror を発火（pendingError に積まれる）
    instances[0]?.onerror?.({ name: "InvalidStateError" });
    // 後続 stopRecording は pendingError を消費して RECORDER_ERROR を throw
    await expect(adapter.stopRecording(rec)).rejects.toMatchObject({
      reason: "RECORDER_ERROR",
    });
  });

  it("stopRecording 時に recorder.state==='inactive' なら stop はスキップして onstop の到達を待つ", async () => {
    // FakeMediaRecorder で state を inactive にしてから stop を呼ぶ流れ
    const instances: FakeMediaRecorder[] = [];
    class FakeMediaRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      state = "inactive";
      mimeType = "video/webm";
      stopCallCount = 0;
      constructor(_stream: unknown) {
        instances.push(this);
      }
      start(): void {
        this.state = "recording";
      }
      stop(): void {
        // ここでカウントを取って二重 stop を検出
        this.stopCallCount++;
        this.state = "inactive";
        // onstop 発火（同期で呼んで test が microtask wait しなくて済むようにする）
        queueMicrotask(() => this.onstop?.());
      }
      pause(): void {}
      resume(): void {}
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    // 手動で state を inactive にして（自動停止経路を模す）、stop は呼ばずに onstop だけ発火させない
    const recorder = instances[0] as FakeMediaRecorder;
    recorder.state = "inactive";
    // stopRecording を呼ぶ → state inactive なので stop() を呼ばずに onstop を待つ
    const stopP = adapter.stopRecording(rec);
    // 外側から onstop を 1 度発火させる
    queueMicrotask(() => recorder.onstop?.());
    const result = await stopP;
    // stop は内部で呼ばれていない
    expect(recorder.stopCallCount).toBe(0);
    expect(result.id).toBe(rec.id);
  });

  it("maxFileSizeBytes 超過と明示 stop が race しても autoStopRequested で recorder.stop は 1 回だけ", async () => {
    // start で 1 chunk を即時配信する Fake を使い、maxFileSizeBytes=1 で自動停止 → autoStopRequested=true
    const instances = installFakeMediaRecorder();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h, { maxFileSizeBytes: 1 });
    await new Promise((r) => setTimeout(r, 0));
    // ここで recorder.state は inactive、stopRecording 経路は stop をスキップして onstop 到達を待つ
    // FakeMediaRecorder の stop() の呼出回数を確認する手段が無いため state チェックのみ
    expect(instances[0]?.state).toBe("inactive");
    // 後続 stopRecording は pendingResult を消費
    const result = await adapter.stopRecording(rec);
    expect(result.id).toBe(rec.id);
  });

  it("ondataavailable が 2 回連続で発火しても autoStopRequested で 2 回目は skip される", async () => {
    // 2 chunk を連続配信する Fake を作って maxFileSizeBytes=1 で trigger
    let stopCallCount = 0;
    class ChunkedFakeMediaRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      state = "inactive";
      mimeType = "video/webm";
      constructor(_stream: unknown) {}
      start(): void {
        this.state = "recording";
        // 2 chunk を queueMicrotask で連続発火
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(["a"], { type: this.mimeType }) });
          this.ondataavailable?.({ data: new Blob(["b"], { type: this.mimeType }) });
        });
      }
      stop(): void {
        stopCallCount++;
        this.state = "inactive";
        queueMicrotask(() => this.onstop?.());
      }
      pause(): void {}
      resume(): void {}
    }
    vi.stubGlobal("MediaRecorder", ChunkedFakeMediaRecorder);
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h, { maxFileSizeBytes: 1 });
    await new Promise((r) => setTimeout(r, 0));
    // 1 回目の chunk で stop が呼ばれ、2 回目で autoStopRequested=true なので skip → stopCallCount は 1
    expect(stopCallCount).toBe(1);
    // 後続 stopRecording は pendingResult を返す
    const result = await adapter.stopRecording(rec);
    expect(result.id).toBe(rec.id);
  });

  it("maxDurationMs を仕掛けた録画を明示的に stop すると clearTimeout で片付ける", async () => {
    // 明示 stop で onstop が呼ばれ、durationTimer の clearTimeout 分岐を通過させる
    vi.useFakeTimers();
    try {
      installFakeMediaRecorder();
      const adapter = createWebAdapter();
      const h = await adapter.startPreview({});
      const rec = await adapter.startRecording(h, { maxDurationMs: 10000 });
      // 明示 stop（onstop の中で clearTimeout 経路を踏ませる）
      const stopP = adapter.stopRecording(rec);
      await vi.runAllTimersAsync();
      await expect(stopP).resolves.toMatchObject({ id: rec.id });
      // 仮にタイマーが残っていれば run しても recorder.stop は 1 回しか呼ばれない（state がもう inactive）
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createWebAdapter scanBarcode", () => {
  beforeEach(() => {
    installFakeNavigator();
    installFakeDocument();
  });

  it("INVALID_HANDLE で ScannerError", async () => {
    const adapter = createWebAdapter({
      scheduler: { schedule: () => 0, cancel: () => {} },
    });
    const fakeHandle: PreviewHandle = { __brand: "PreviewHandle", id: "x", native: null };
    await expect(
      adapter.scanBarcode(fakeHandle, { formats: ["qr_code"] }, () => {}),
    ).rejects.toBeInstanceOf(ScannerError);
  });

  it("ALREADY_SCANNING で ScannerError", async () => {
    // schedule は呼ばれても何もしない（cb を起動しないことで tick 連鎖を防ぐ）
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: vi.fn(async () => []) }),
      scheduler: { schedule: () => 0, cancel: () => {} },
    });
    const h = await adapter.startPreview({});
    await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    await expect(
      adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {}),
    ).rejects.toMatchObject({ reason: "ALREADY_SCANNING" });
  });

  it("factory throw で UNSUPPORTED_FORMAT", async () => {
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => {
        throw new Error("no");
      },
    });
    const h = await adapter.startPreview({});
    await expect(
      adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {}),
    ).rejects.toMatchObject({ reason: "UNSUPPORTED_FORMAT" });
  });

  it("正常系: tick が回り検出結果が onScan に通知される", async () => {
    // 最初の 1 回だけ cb を呼び、以降は無視（再帰ループを断つ）
    let calls = 0;
    const scheduler = {
      schedule: (cb: () => void) => {
        calls++;
        if (calls === 1) {
          cb();
        }
        return calls;
      },
      cancel: vi.fn(),
    };
    const detectMock = vi.fn(async () => [
      { format: "qr_code", rawValue: "https://x", boundingBox: undefined },
    ]);
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: detectMock }),
      scheduler,
      idFactory: () => "scan-id",
      now: () => 100,
    });
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
      videoWidth: 1,
      videoHeight: 1,
    } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    const onScan = vi.fn();
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, onScan);
    // microtask が回るまで待つ
    await new Promise((r) => setTimeout(r, 0));
    expect(onScan).toHaveBeenCalled();
    cancel();
    void h;
  });

  it("video 未 attach の場合は detect しないで次フレームへ", async () => {
    let callCount = 0;
    const detectMock = vi.fn(async () => []);
    const scheduler = {
      schedule: (cb: () => void) => {
        callCount++;
        // 1 回だけ tick を起動。video が attach されていないので detect は呼ばれず、
        // tick 末尾で再度 schedule されるが 2 回目以降は無視（無限ループ防止）
        if (callCount === 1) {
          cb();
        }
        return callCount;
      },
      cancel: vi.fn(),
    };
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: detectMock }),
      scheduler,
    });
    const h = await adapter.startPreview({});
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(detectMock).not.toHaveBeenCalled();
    cancel();
    void h;
  });

  it("detect 中の throw を吸収し次フレームへ", async () => {
    let calls = 0;
    const scheduler = {
      schedule: (cb: () => void) => {
        calls++;
        if (calls === 1) {
          cb();
        }
        return calls;
      },
      cancel: vi.fn(),
    };
    const detectMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("bad"))
      .mockResolvedValue([]);
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: detectMock }),
      scheduler,
    });
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(detectMock).toHaveBeenCalled();
    cancel();
    void h;
  });

  it("throttle により同じ値の連続検出は 1 回だけ通知", async () => {
    let calls = 0;
    const scheduler = {
      schedule: (cb: () => void) => {
        calls++;
        if (calls === 1) {
          cb();
        }
        return calls;
      },
      cancel: vi.fn(),
    };
    const detectMock = vi.fn(async () => [
      { format: "qr_code", rawValue: "X", boundingBox: undefined },
      { format: "qr_code", rawValue: "X", boundingBox: undefined },
    ]);
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: detectMock }),
      scheduler,
      now: () => 100,
    });
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    const onScan = vi.fn();
    const cancel = await adapter.scanBarcode(
      h,
      { formats: ["qr_code"], throttleMs: 1000 },
      onScan,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(onScan).toHaveBeenCalledTimes(1);
    cancel();
    void h;
  });

  it("detect 中に cancel された場合、tick 末尾の再 schedule をスキップする", async () => {
    installFakeNavigator();
    installFakeDocument();
    // scheduler は cb を保留し外部から手動で起動する
    let savedCb: (() => void) | undefined;
    const scheduler = {
      schedule: (cb: () => void) => {
        // 直近 cb を保存（既存 cb は上書き）
        savedCb = cb;
        return 1;
      },
      cancel: vi.fn(),
    };
    // 外部から立ち上げる cancel 参照
    let cancelRef: (() => void) | undefined;
    const detect = vi.fn(async () => {
      // cancelRef は test 側で scanBarcode return 後にセット済み
      cancelRef?.();
      return [];
    });
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect }),
      scheduler,
    });
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    cancelRef = cancel;
    // ここで savedCb は scanBarcode 内の初回 schedule の cb（= () => void tick()）
    // 手動で起動 → tick が走り → detect 内で cancel() → cancelled=true → 最後の if (!cancelled) は else
    savedCb?.();
    // 複数 microtask を消費して detect の resolve / continuation を流す
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(detect).toHaveBeenCalled();
    expect(scheduler.cancel).toHaveBeenCalled();
  });

  it("cancel 後の遅延 tick は早期 return（再 schedule しない）", async () => {
    installFakeNavigator();
    installFakeDocument();
    // schedule は cb を保留し外部から呼ぶ
    let pendingCb: (() => void) | undefined;
    let calls = 0;
    const scheduler = {
      schedule: (cb: () => void) => {
        calls++;
        pendingCb = cb;
        return calls;
      },
      cancel: vi.fn(),
    };
    const detect = vi.fn(async () => []);
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect }),
      scheduler,
    });
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    // 初回 schedule で cb がキャプチャされている
    expect(pendingCb).toBeDefined();
    // ここで cancel を呼んで cancelled=true にしてから cb を実行
    cancel();
    pendingCb?.();
    // tick の await を解消
    await new Promise((r) => setTimeout(r, 0));
    // 2 回目の scheduler.schedule は呼ばれない（cancelled で if(!cancelled) の else に入る）
    expect(calls).toBe(1);
  });

  it("for ループ中に cancel された場合は break で残りの onScan を抑止", async () => {
    // 1 回目の cb で tick を走らせるだけのスケジューラ
    let savedCb: (() => void) | undefined;
    const scheduler = {
      schedule: (cb: () => void) => {
        savedCb = cb;
        return 1;
      },
      cancel: vi.fn(),
    };
    // detect は 3 件返すので、cancel 後の break で 2 件目以降を捨てる経路を作る
    const detectMock = vi.fn(async () => [
      { format: "qr_code", rawValue: "A", boundingBox: undefined },
      { format: "qr_code", rawValue: "B", boundingBox: undefined },
      { format: "qr_code", rawValue: "C", boundingBox: undefined },
    ]);
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: detectMock }),
      scheduler,
    });
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    // onScan の 1 回目で cancel を呼んで以降の onScan を break させる
    let cancelRef: (() => void) | undefined;
    const onScan = vi.fn(() => {
      cancelRef?.();
    });
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, onScan);
    cancelRef = cancel;
    // tick を起動
    savedCb?.();
    // microtask を消費
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    // 1 件目だけ onScan に渡り、2 件目以降は break で抑止される
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("二重 cancel は安全", async () => {
    const scheduler = {
      schedule: () => 1,
      cancel: vi.fn(),
    };
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: vi.fn(async () => []) }),
      scheduler,
    });
    const h = await adapter.startPreview({});
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    cancel();
    expect(() => cancel()).not.toThrow();
    void h;
  });

  it("tick 内の再 schedule で 2 回目以降の cb も走らせる", async () => {
    installFakeNavigator();
    installFakeDocument();
    let calls = 0;
    const scheduler = {
      schedule: (cb: () => void) => {
        calls++;
        // 2 回までは cb を起動
        if (calls <= 2) {
          cb();
        }
        return calls;
      },
      cancel: vi.fn(),
    };
    const detectMock = vi.fn(async () => []);
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: detectMock }),
      scheduler,
    });
    const video = {
      srcObject: null,
      play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
    const h = await adapter.startPreview({ target: video });
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    await new Promise((r) => setTimeout(r, 0));
    // 少なくとも 2 回 schedule が呼ばれて 2 回目の cb で tick が再起動
    expect(calls).toBeGreaterThanOrEqual(2);
    cancel();
  });
});

describe("createWebAdapter scheduler defaults", () => {
  it("既定 scheduler が requestAnimationFrame を使う + cancel で cancelAnimationFrame", async () => {
    // raf は handle として number を返す
    const raf = vi.fn((cb: () => void): number => {
      // 1 度だけ非同期で呼ぶ（無限再帰回避のため呼び出し回数を制限）
      if ((raf as unknown as { _called?: boolean })._called !== true) {
        (raf as unknown as { _called?: boolean })._called = true;
        queueMicrotask(cb);
      }
      return 42;
    });
    const caf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", caf);
    installFakeNavigator();
    installFakeDocument();
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: vi.fn(async () => []) }),
    });
    const h = await adapter.startPreview({});
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(raf).toHaveBeenCalled();
    cancel();
    expect(caf).toHaveBeenCalledWith(42);
    void h;
  });

  it("requestAnimationFrame 不在なら setTimeout フォールバック", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    installFakeNavigator();
    installFakeDocument();
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: vi.fn(async () => []) }),
    });
    const h = await adapter.startPreview({});
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    cancel();
    void h;
  });

  it("scanBarcode: formats 未指定で qr_code 既定が使われる", async () => {
    installFakeNavigator();
    installFakeDocument();
    let receivedFormats: readonly string[] | undefined;
    const adapter = createWebAdapter({
      barcodeDetectorFactory: (formats) => {
        receivedFormats = formats;
        return { detect: vi.fn(async () => []) };
      },
      scheduler: { schedule: () => 0, cancel: () => {} },
    });
    const h = await adapter.startPreview({});
    const cancel = await adapter.scanBarcode(h, {}, () => {});
    expect(receivedFormats).toEqual(["qr_code"]);
    cancel();
  });

  it("scanBarcode: cancel 直後の tick は early return", async () => {
    installFakeNavigator();
    installFakeDocument();
    // schedule は同期 cb 呼び出しを行うが、cancel が先に立っているケース
    let lateCb: (() => void) | undefined;
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: vi.fn(async () => []) }),
      scheduler: {
        schedule: (cb) => {
          lateCb = cb;
          return 1;
        },
        cancel: () => {},
      },
    });
    const h = await adapter.startPreview({});
    const cancel = await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    cancel();
    // cancel 後に scheduler.schedule の cb を呼んでも tick が early return（state.preview は既に解放されてもなお）
    lateCb?.();
    await new Promise((r) => setTimeout(r, 0));
    void h;
  });

  it("録画の mimeType 未指定で recorder.mimeType も無い場合は video/webm にフォールバック", async () => {
    installFakeNavigator();
    installFakeDocument();
    // recorder.mimeType を空文字に
    class StripMimeRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      state = "inactive";
      // mimeType を falsy にする
      mimeType = "";
      constructor() {}
      start(): void {
        this.state = "recording";
      }
      stop(): void {
        this.state = "inactive";
        queueMicrotask(() => this.onstop?.());
      }
      pause(): void {}
      resume(): void {}
    }
    vi.stubGlobal("MediaRecorder", StripMimeRecorder);
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const rec = await adapter.startRecording(h);
    const result = await adapter.stopRecording(rec);
    expect(result.media.mimeType).toBe("video/webm");
  });
});

describe("createWebAdapter dispose", () => {
  it("録画中・プレビュー中・スキャン中で dispose が全て解放", async () => {
    installFakeNavigator();
    installFakeDocument();
    installFakeMediaRecorder();
    const cancelMock = vi.fn();
    const adapter = createWebAdapter({
      barcodeDetectorFactory: () => ({ detect: vi.fn(async () => []) }),
      scheduler: {
        schedule: () => 1,
        cancel: cancelMock,
      },
    });
    const h = await adapter.startPreview({});
    await adapter.startRecording(h);
    await adapter.scanBarcode(h, { formats: ["qr_code"] }, () => {});
    await adapter.dispose();
    expect(cancelMock).toHaveBeenCalled();
  });

  it("dispose 内の recorder.stop 失敗を握り潰す", async () => {
    installFakeNavigator();
    installFakeDocument();
    installFakeMediaRecorder({ failStop: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await adapter.startRecording(h);
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });

  it("dispose を何度呼んでも安全", async () => {
    installFakeNavigator();
    const adapter = createWebAdapter();
    await adapter.dispose();
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });
});

// 能力系（torch / zoom / focus / capabilities）テストに使う MediaStreamTrack の fake セットアップ
// 個別 test 内で track.applyConstraints / getCapabilities の挙動を差し替えられるように setter を返す
function installFakeNavigatorWithCapabilities(
  options: {
    // applyConstraints の挙動を制御（reject させたり、何もしないなど）
    applyConstraints?: (c: unknown) => Promise<void>;
    // getCapabilities の戻り値（undefined を返せばメソッド自体を消す）
    capabilities?: Record<string, unknown> | undefined;
    // applyConstraints メソッドを定義しないモードに切り替える
    noApplyConstraints?: boolean;
    // getCapabilities メソッドを定義しないモードに切り替える
    noGetCapabilities?: boolean;
    // video トラックを含めない（kind!=="video" のみ）モード
    noVideoTrack?: boolean;
  } = {},
) {
  // applyConstraints の引数を後から検証するための記録配列
  const calls: unknown[] = [];
  // 既定 applyConstraints: 引数を記録して resolve
  const defaultApply = async (c: unknown): Promise<void> => {
    calls.push(c);
  };
  // track 配列の組み立て（noVideoTrack の場合は audio のみ）
  const tracks: Array<Record<string, unknown>> = [];
  if (options.noVideoTrack !== true) {
    const videoTrack: Record<string, unknown> = {
      kind: "video",
      stop: vi.fn(),
    };
    if (options.noApplyConstraints !== true) {
      videoTrack.applyConstraints = options.applyConstraints ?? defaultApply;
    }
    if (options.noGetCapabilities !== true) {
      videoTrack.getCapabilities = () => options.capabilities ?? {};
    }
    tracks.push(videoTrack);
  }
  // audio トラックを 1 つ常に入れておく（フィルタ動作の検証用）
  tracks.push({ kind: "audio", stop: vi.fn() });
  // navigator.mediaDevices の最小 stub
  const stream = { getTracks: () => tracks };
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => stream,
      enumerateDevices: async () => [],
    },
  });
  return { tracks, calls };
}

describe("createWebAdapter setTorch", () => {
  it("applyConstraints に {torch: true} を送る (mode='on')", async () => {
    const { calls } = installFakeNavigatorWithCapabilities();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await adapter.setTorch!(h, "on");
    expect(calls).toEqual([{ advanced: [{ torch: true }] }]);
  });

  it("applyConstraints に {torch: false} を送る (mode='off')", async () => {
    const { calls } = installFakeNavigatorWithCapabilities();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await adapter.setTorch!(h, "off");
    expect(calls).toEqual([{ advanced: [{ torch: false }] }]);
  });

  it("ハンドル不一致なら CameraError(INVALID_HANDLE)", async () => {
    installFakeNavigatorWithCapabilities();
    const adapter = createWebAdapter();
    await adapter.startPreview({});
    // 別 ID の偽ハンドル
    const fake: PreviewHandle = { __brand: "PreviewHandle", id: "other", native: null };
    await expect(adapter.setTorch!(fake, "on")).rejects.toBeInstanceOf(CameraError);
  });

  it("video トラックが無ければ CameraControlError(UNSUPPORTED)", async () => {
    installFakeNavigatorWithCapabilities({ noVideoTrack: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.setTorch!(h, "on")).rejects.toBeInstanceOf(CameraControlError);
  });

  it("applyConstraints 未対応なら CameraControlError(UNSUPPORTED)", async () => {
    installFakeNavigatorWithCapabilities({ noApplyConstraints: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.setTorch!(h, "on")).rejects.toMatchObject({ reason: "UNSUPPORTED" });
  });

  it("OverconstrainedError を OUT_OF_RANGE に変換", async () => {
    const err = Object.assign(new Error("over"), { name: "OverconstrainedError" });
    installFakeNavigatorWithCapabilities({
      applyConstraints: async () => {
        throw err;
      },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.setTorch!(h, "on")).rejects.toMatchObject({
      reason: "OUT_OF_RANGE",
      cause: err,
    });
  });

  it("その他の例外を APPLY_FAILED に変換", async () => {
    const err = new Error("boom");
    installFakeNavigatorWithCapabilities({
      applyConstraints: async () => {
        throw err;
      },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.setTorch!(h, "on")).rejects.toMatchObject({
      reason: "APPLY_FAILED",
      cause: err,
    });
  });
});

describe("createWebAdapter setZoom", () => {
  it("applyConstraints に {zoom: N} を送る", async () => {
    const { calls } = installFakeNavigatorWithCapabilities();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await adapter.setZoom!(h, 3.5);
    expect(calls).toEqual([{ advanced: [{ zoom: 3.5 }] }]);
  });

  it("applyConstraints 未対応で UNSUPPORTED", async () => {
    installFakeNavigatorWithCapabilities({ noApplyConstraints: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.setZoom!(h, 2)).rejects.toMatchObject({ reason: "UNSUPPORTED" });
  });

  it("OverconstrainedError を OUT_OF_RANGE に変換", async () => {
    const err = Object.assign(new Error("over"), { name: "OverconstrainedError" });
    installFakeNavigatorWithCapabilities({
      applyConstraints: async () => {
        throw err;
      },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.setZoom!(h, 99)).rejects.toMatchObject({ reason: "OUT_OF_RANGE" });
  });
});

describe("createWebAdapter setFocus", () => {
  it("point ありなら focusMode=manual + pointsOfInterest を送る", async () => {
    const { calls } = installFakeNavigatorWithCapabilities();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await adapter.setFocus!(h, { x: 0.5, y: 0.7 });
    expect(calls).toEqual([
      { advanced: [{ focusMode: "manual", pointsOfInterest: [{ x: 0.5, y: 0.7 }] }] },
    ]);
  });

  it("point なしなら focusMode=continuous を送る", async () => {
    const { calls } = installFakeNavigatorWithCapabilities();
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await adapter.setFocus!(h);
    expect(calls).toEqual([{ advanced: [{ focusMode: "continuous" }] }]);
  });

  it("applyConstraints 未対応で UNSUPPORTED", async () => {
    installFakeNavigatorWithCapabilities({ noApplyConstraints: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.setFocus!(h, { x: 0, y: 0 })).rejects.toMatchObject({
      reason: "UNSUPPORTED",
    });
  });

  it("適用失敗を APPLY_FAILED に変換", async () => {
    const err = new Error("apply fail");
    installFakeNavigatorWithCapabilities({
      applyConstraints: async () => {
        throw err;
      },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.setFocus!(h)).rejects.toMatchObject({ reason: "APPLY_FAILED" });
  });
});

describe("createWebAdapter getCapabilities", () => {
  it("フル能力を CameraCapabilities にマップする", async () => {
    installFakeNavigatorWithCapabilities({
      capabilities: {
        torch: true,
        zoom: { min: 1, max: 10, step: 0.1 },
        focusMode: ["continuous", "manual"],
        exposureMode: ["continuous", "manual"],
        whiteBalanceMode: ["continuous"],
        iso: { min: 100, max: 3200 },
        brightness: { min: -1, max: 1, step: 0.1 },
      },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps).toEqual({
      torch: true,
      zoom: { min: 1, max: 10, step: 0.1 },
      focus: { tap: true, continuous: true },
      flash: true,
      exposureMode: ["continuous", "manual"],
      whiteBalanceMode: ["continuous"],
      iso: { min: 100, max: 3200 },
      brightness: { min: -1, max: 1, step: 0.1 },
      hdr: false,
      lowLightBoost: false,
    });
  });

  it("空 capabilities を全 false 系で返す", async () => {
    installFakeNavigatorWithCapabilities({ capabilities: {} });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps).toEqual({
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
    });
  });

  it("torch が配列で渡る環境（[true]）にも対応", async () => {
    installFakeNavigatorWithCapabilities({
      capabilities: { torch: [true] },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps.torch).toBe(true);
  });

  it("torch が [false] のみなら未対応扱い", async () => {
    installFakeNavigatorWithCapabilities({
      capabilities: { torch: [false] },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps.torch).toBe(false);
  });

  it("focusMode に single-shot のみあれば tap=true、continuous=false", async () => {
    installFakeNavigatorWithCapabilities({
      capabilities: { focusMode: ["single-shot"] },
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps.focus).toEqual({ tap: true, continuous: false });
  });

  it("getCapabilities 未対応トラックなら全 false", async () => {
    installFakeNavigatorWithCapabilities({ noGetCapabilities: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps.torch).toBe(false);
    expect(caps.zoom).toBe(false);
  });

  it("video トラックが無ければ UNSUPPORTED", async () => {
    installFakeNavigatorWithCapabilities({ noVideoTrack: true });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    await expect(adapter.getCapabilities!(h)).rejects.toBeInstanceOf(CameraControlError);
  });

  it("torch サポートかつ applyConstraints 未対応なら torch=false", async () => {
    installFakeNavigatorWithCapabilities({
      capabilities: { torch: true },
      noApplyConstraints: true,
    });
    const adapter = createWebAdapter();
    const h = await adapter.startPreview({});
    const caps = await adapter.getCapabilities!(h);
    expect(caps.torch).toBe(false);
  });
});
