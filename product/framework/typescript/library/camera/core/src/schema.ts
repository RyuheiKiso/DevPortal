// zod を取り込み（runtime バリデーション用）
import { z } from "zod";

// カメラ向きの zod スキーマ
export const cameraFacingSchema = z.enum(["front", "back", "external"]);

// 解像度ヒントのスキーマ
export const cameraResolutionSchema = z.object({
  // 幅は正数
  width: z.number().int().positive(),
  // 高さも正数
  height: z.number().int().positive(),
});

// 静止画オプションのスキーマ
export const photoOptionsSchema = z.object({
  // 品質は 0-1 範囲
  quality: z.number().min(0).max(1).optional(),
  // MIME は jpeg / png のみ
  mimeType: z.enum(["image/jpeg", "image/png"]).optional(),
  // フラッシュ動作
  flash: z.enum(["auto", "on", "off"]).optional(),
  // EXIF 付与可否
  includeExif: z.boolean().optional(),
});

// 動画録画オプションのスキーマ
export const recordingOptionsSchema = z.object({
  // MIME 任意（実装で対応判定）
  mimeType: z.string().optional(),
  // 最大録画時間（ms、正数）
  maxDurationMs: z.number().int().positive().optional(),
  // 最大サイズ（bytes、正数）
  maxFileSizeBytes: z.number().int().positive().optional(),
  // 音声含有
  audio: z.boolean().optional(),
  // ビットレート（bps、正数）
  videoBitsPerSecond: z.number().int().positive().optional(),
});

// バーコード形式のスキーマ
export const barcodeFormatSchema = z.enum([
  "qr_code",
  "code_39",
  "code_93",
  "code_128",
  "codabar",
  "data_matrix",
  "ean_8",
  "ean_13",
  "itf",
  "pdf417",
  "upc_a",
  "upc_e",
  "aztec",
]);

// スキャナ設定のスキーマ
export const scannerConfigSchema = z.object({
  // 検出対象 (空配列は不可)
  formats: z.array(barcodeFormatSchema).nonempty().optional(),
  // throttle (0 以上)
  throttleMs: z.number().min(0).optional(),
  // 検出領域（0-1 範囲の相対座標）
  region: z
    .object({
      // 左上 x
      x: z.number().min(0).max(1),
      // 左上 y
      y: z.number().min(0).max(1),
      // 幅
      width: z.number().min(0).max(1),
      // 高さ
      height: z.number().min(0).max(1),
    })
    .optional(),
});

// プレビュー構成のスキーマ
export const previewConfigSchema = z.object({
  // デバイス ID
  deviceId: z.string().min(1).optional(),
  // facing
  facing: cameraFacingSchema.optional(),
  // 解像度ヒント
  resolution: cameraResolutionSchema.optional(),
  // FPS
  frameRate: z.number().positive().optional(),
  // 音声有無
  audio: z.boolean().optional(),
  // target は任意 (HTMLVideoElement 等を許容)
  target: z.unknown().optional(),
});

// CameraManagerConfig のスキーマ
export const cameraManagerConfigSchema = z.object({
  // 時刻関数
  now: z.function().returns(z.number()).optional(),
  // ID 関数
  idFactory: z.function().returns(z.string()).optional(),
});

// PermissionDescriptor のスキーマ
export const permissionDescriptorSchema = z.object({
  // カメラは必須 true
  camera: z.literal(true).or(z.boolean()),
  // マイクは任意
  microphone: z.boolean().optional(),
  // メディアライブラリは任意
  mediaLibrary: z.boolean().optional(),
});

// CameraManagerConfig の zod 推論型（呼出側で `Input` として export）
export type CameraManagerConfigInput = z.infer<typeof cameraManagerConfigSchema>;

// 設定値のバリデーション（呼出側はこの関数で正規化済みの値を受け取る）
export function validateCameraConfig(input: unknown): CameraManagerConfigInput {
  // parse は失敗時に ZodError を投げる
  return cameraManagerConfigSchema.parse(input);
}
