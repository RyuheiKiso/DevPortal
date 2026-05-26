# @k1s0-ts-camera/react

`@k1s0-ts-camera/core` の **React (Web) バインディング** です。MediaDevices / MediaRecorder / BarcodeDetector を内蔵 `webAdapter` で扱い、Provider と hooks を提供します。

## インストール

```bash
npm install @k1s0-ts-camera/react react
```

## 使用例

```tsx
import { CameraProvider, useCameraPreview, usePhotoCapture } from "@k1s0-ts-camera/react";

function App() {
  return (
    <CameraProvider>
      <Capture />
    </CameraProvider>
  );
}

function Capture() {
  const { videoRef, start, stop } = useCameraPreview({ facing: "user" });
  const { take, lastPhoto } = usePhotoCapture();
  return (
    <div>
      <video ref={videoRef} autoPlay playsInline />
      <button onClick={() => start()}>開始</button>
      <button onClick={() => stop()}>停止</button>
      <button onClick={() => take({ quality: 0.85 })}>撮影</button>
      {lastPhoto?.media.kind === "dataUrl" && <img src={lastPhoto.media.value} />}
    </div>
  );
}
```

## Capabilities & Controls

torch / zoom / tap focus / 能力情報取得を hook 経由で提供します。`webAdapter` は `MediaStreamTrack.applyConstraints` と `MediaStreamTrack.getCapabilities` を使って実装されているため、Chromium 系ブラウザの背面カメラなど対応端末でのみ動作します（`useCameraCapabilities()` で feature detection してください）。

```tsx
import {
  useTorch,
  useZoom,
  useFocus,
  useCameraCapabilities,
} from "@k1s0-ts-camera/react";

function Controls() {
  // 各 hook は内部で useCameraCapabilities を共有
  const { capabilities } = useCameraCapabilities();
  const { mode, set: setTorch, supported: torchOk } = useTorch();
  const { zoom, set: setZoom, range, supported: zoomOk } = useZoom();
  const { focus, supported: focusOk } = useFocus();

  // タップフォーカスはプレビュー左上 (0,0) 〜 右下 (1,1) の相対座標
  const onTap = (e: React.MouseEvent<HTMLVideoElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    void focus({ x, y });
  };

  return (
    <div>
      {torchOk && (
        <button onClick={() => setTorch(mode === "on" ? "off" : "on")}>
          Torch: {mode}
        </button>
      )}
      {zoomOk && range && (
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step ?? 0.1}
          value={zoom}
          onChange={(e) => void setZoom(Number(e.target.value))}
        />
      )}
      {focusOk && <video onClick={onTap} />}
      <pre>{JSON.stringify(capabilities, null, 2)}</pre>
    </div>
  );
}
```

### Capability マトリクス（Web 環境）

| 機能 | 対応 | 備考 |
|------|------|------|
| torch | ✅ | `track.applyConstraints({ advanced: [{ torch }] })` |
| zoom | ✅ | 対応デバイスのみ。範囲外は `CameraControlError("OUT_OF_RANGE")` |
| tap focus | ✅ | `focusMode: "manual" + pointsOfInterest`（相対 0..1） |
| exposure / WB / iso / brightness | ✅ | `MediaTrackCapabilities` 経由 |
| hdr / lowLightBoost | ❌ | Web 標準 API なし |

## Backlog

- `focus` に絶対 px 座標オプション
- `ImageCapture.setOptions` を使った独立フラッシュ制御
- `devicechange` イベントへの自動追従

## ライセンス

UNLICENSED (社内利用)
