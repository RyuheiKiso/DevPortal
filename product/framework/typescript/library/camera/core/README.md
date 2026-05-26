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

## ライセンス

UNLICENSED (社内利用)
