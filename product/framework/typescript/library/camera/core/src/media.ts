// 撮影成果物の運搬型（Web は blob / dataUrl、RN は filePath が既定）
export type CapturedMedia =
  // バイナリ Blob（Web）
  | { kind: "blob"; blob: Blob; mimeType: string }
  // Data URL（小サイズプレビュー用）
  | { kind: "dataUrl"; value: string; mimeType: string }
  // ファイルパス（RN・ネイティブ保存）
  | { kind: "filePath"; path: string; mimeType: string };

// media kind の判定 type guard 群
export function isBlobMedia(value: CapturedMedia): value is Extract<CapturedMedia, { kind: "blob" }> {
  // kind フィールドで判別
  return value.kind === "blob";
}

// dataUrl 判定
export function isDataUrlMedia(
  value: CapturedMedia,
): value is Extract<CapturedMedia, { kind: "dataUrl" }> {
  // kind フィールドで判別
  return value.kind === "dataUrl";
}

// filePath 判定
export function isFilePathMedia(
  value: CapturedMedia,
): value is Extract<CapturedMedia, { kind: "filePath" }> {
  // kind フィールドで判別
  return value.kind === "filePath";
}
