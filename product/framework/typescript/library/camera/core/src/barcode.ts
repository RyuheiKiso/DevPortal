// BarcodeFormat ユニオン型を取り込み
import type { BarcodeFormat } from "./types.js";

// サポートする全 BarcodeFormat 値のセット（type guard の判定に使う）
const ALL_BARCODE_FORMATS: ReadonlySet<BarcodeFormat> = new Set<BarcodeFormat>([
  // 2D 系
  "qr_code",
  "data_matrix",
  "pdf417",
  "aztec",
  // 1D 系
  "code_39",
  "code_93",
  "code_128",
  "codabar",
  "ean_8",
  "ean_13",
  "itf",
  "upc_a",
  "upc_e",
]);

// 任意の値が BarcodeFormat に含まれるかを判定する type guard
export function isBarcodeFormat(value: unknown): value is BarcodeFormat {
  // 文字列でなければ即 false
  if (typeof value !== "string") {
    return false;
  }
  // Set への所属で判定
  return ALL_BARCODE_FORMATS.has(value as BarcodeFormat);
}

// 標準 throttle / dedupe 判定の比較関数
// 同一 value かつ throttleMs 以内の検出を抑止する
export function shouldEmitScan(
  current: { value: string; scannedAt: number },
  previous: { value: string; scannedAt: number } | undefined,
  throttleMs: number,
): boolean {
  // 直前検出が無ければ常に emit
  if (previous === undefined) {
    return true;
  }
  // throttleMs が 0 以下なら抑止しない
  if (throttleMs <= 0) {
    return true;
  }
  // value が異なれば常に emit
  if (previous.value !== current.value) {
    return true;
  }
  // 同じ value だが時間差が throttleMs を超えていれば emit
  return current.scannedAt - previous.scannedAt >= throttleMs;
}
