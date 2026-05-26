# @k1s0-ts-camera/core

DevPortal の **headless カメラコア** ライブラリです。静止画キャプチャ・動画録画・ライブプレビュー・QR/バーコードスキャンを統一 API で提供し、Web / React Native のいずれでも `CameraAdapter` を差し替えるだけで動作します。

## 特徴

- **アダプタ抽象**: `CameraAdapter` インターフェイスを実装すれば任意のプラットフォームに接続可能
- **状態機械**: プレビュー → 撮影 / 録画 / スキャン の状態遷移をコアで保証
- **権限モデル**: `granted` / `denied` / `prompt` / `blocked` / `unavailable` の 5 状態を統合
- **オプション連携**: `@k1s0-ts-logger/core` と `@k1s0-ts-notification/core` を *optional peer* で連携可能
- **100% カバレッジ**: vitest で全行 / 全分岐網羅

## インストール

```bash
npm install @k1s0-ts-camera/core
```

## 使用例

```ts
// core 単体ではアダプタが必要（通常は @k1s0-ts-camera/react や /react-native から利用）
import { createCameraManager } from "@k1s0-ts-camera/core";
import { createMyAdapter } from "./myAdapter.js";

// アダプタを生成
const adapter = createMyAdapter();
// マネージャを生成（headless）
const manager = createCameraManager(adapter);
// プレビュー開始
await manager.startPreview({ facing: "back" });
// 静止画キャプチャ
const photo = await manager.takePicture({ quality: 0.8 });
// 後始末
await manager.dispose();
```

## Capabilities & Controls

`CameraManager` は torch / zoom / tap focus / 能力情報取得を統一 API で提供します。adapter 未対応時は `CameraControlError("UNSUPPORTED")` を投げます。

```ts
// トーチ（持続点灯）
await manager.setTorch("on");
await manager.setTorch("off");

// ズーム倍率（adapter 側で device range に clamp / 範囲外で OUT_OF_RANGE）
await manager.setZoom(2.5);

// タップフォーカス（相対座標 0..1。左上 (0,0) 〜 右下 (1,1)）
await manager.setFocus({ x: 0.5, y: 0.5 });
// 連続オートフォーカスへ戻す
await manager.setFocus();

// 能力情報（torch / zoom range / focus / flash / exposureMode / WB / iso / brightness / hdr / lowLightBoost）
const caps = await manager.getCapabilities();
if (caps.torch) { /* 利用可能 */ }
if (caps.zoom !== false) { /* {min,max,step} で range が取れる */ }
```

`CameraCapabilities` は `MediaTrackCapabilities` 相当の拡張版で、未対応項目は `false` で示します。

## Backlog

- `focus` に絶対 px 座標サポートを追加（現状は相対 0..1 のみ）
- `capability-change` / `torch-change` イベントの追加
- `PhotoOptions.flash` と torch の自動連動
- Windows MediaCapture API の完全実装（現状は DI スタブ）

## ライセンス

UNLICENSED (社内利用)
