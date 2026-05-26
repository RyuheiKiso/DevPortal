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

## ライセンス

UNLICENSED (社内利用)
