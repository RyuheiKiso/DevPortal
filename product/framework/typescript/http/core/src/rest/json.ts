// JSON serialize / parse 判定のためのヘルパ群

// 値が JSON 化対象（plain object / 配列）かを判定
// FormData / Blob / ArrayBuffer / ReadableStream / string / null は素通し（既に BodyInit）
export function isJsonSerializableBody(value: unknown): boolean {
  // null / undefined は素通し（リクエストボディなし）
  if (value === null || value === undefined) {
    return false;
  }
  // 文字列はそのまま BodyInit として受理される
  if (typeof value === "string") {
    return false;
  }
  // FormData は brand check（多くの環境で globalThis に存在）
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return false;
  }
  // Blob は brand check
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return false;
  }
  // ArrayBuffer / TypedArray は ArrayBuffer.isView で網羅
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return false;
  }
  // ReadableStream は brand check
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
    return false;
  }
  // URLSearchParams は BodyInit として受理されるので素通し
  if (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) {
    return false;
  }
  // 上記以外（plain object / 配列）は JSON 化対象
  return true;
}

// Content-Type ヘッダから JSON 系かを判定（小文字キー想定）
export function isJsonContentType(contentType: string | undefined): boolean {
  // 未設定は false
  if (contentType === undefined) {
    return false;
  }
  // application/json および +json サフィックスを許可
  const lower = contentType.toLowerCase();
  return lower.includes("application/json") || lower.includes("+json");
}
