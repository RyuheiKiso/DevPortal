// zod を取り込み (runtime 検証と型生成の両方に使用)
import { z } from "zod";
// 既存の AuthTokenSet 型を取り込み (型互換性を維持するため)
import type { AuthTokenSet } from "./types.js";

// AuthTokenSet と整合する zod スキーマ
// 全フィールド optional で、余剰フィールドは strict で拒否する
// 余剰フィールド拒否の理由: ストレージ改ざんで挿入された未知フィールドが
// 後段の処理に流れ込むことを防ぐ (セキュリティ境界)
export const authTokenSetSchema: z.ZodType<AuthTokenSet> = z
  .object({
    // API 呼び出しに付与するアクセストークン
    accessToken: z.string().optional(),
    // アクセストークン更新に使うリフレッシュトークン
    refreshToken: z.string().optional(),
    // アクセストークンの有効期限 (Unix epoch milliseconds)
    expiresAt: z.number().optional(),
    // Authorization ヘッダのスキーム
    tokenType: z.string().optional(),
    // IdP から付与されたスコープ文字列
    scope: z.string().optional(),
  })
  // 未知フィールドは検証失敗扱い (=破損データとして reject)
  .strict();
