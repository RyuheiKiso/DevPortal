// 利用者からの format 取り込み
import type { BarcodeFormat } from "@k1s0-ts-camera/core";

// W3C BarcodeDetector の最小サブセット型（runtime 依存を避けるため型のみ）
export interface BarcodeDetectorLike {
  // 検出メソッド（ImageBitmapSource を受け取り Promise を返す）
  detect: (
    source: CanvasImageSource | ImageBitmapSource,
  ) => Promise<ReadonlyArray<BarcodeDetectorEntry>>;
}

// 検出結果 1 件分（cornerPoints は本実装では未使用）
export interface BarcodeDetectorEntry {
  // 形式（W3C 仕様の format 文字列、例 "qr_code"）
  format: string;
  // デコード値
  rawValue: string;
  // 検出 box
  boundingBox?: { x: number; y: number; width: number; height: number };
}

// BarcodeDetector を生成するファクトリ（テスト差し替え可）
export type BarcodeDetectorFactory = (formats: readonly BarcodeFormat[]) => BarcodeDetectorLike;

// 既定のファクトリ：global BarcodeDetector を使う（Chromium 系のみ）
export const defaultBarcodeDetectorFactory: BarcodeDetectorFactory = (formats) => {
  // globalThis 経由でクラスを取得（型は緩く受ける）
  const ctor = (globalThis as { BarcodeDetector?: new (init: { formats: readonly string[] }) => BarcodeDetectorLike })
    .BarcodeDetector;
  // 未対応環境では呼出側が判定すべきなので、ここでは throw する
  if (ctor === undefined) {
    throw new Error("BarcodeDetector is not available in this environment");
  }
  // formats を渡してインスタンス化（W3C 仕様）
  return new ctor({ formats });
};
