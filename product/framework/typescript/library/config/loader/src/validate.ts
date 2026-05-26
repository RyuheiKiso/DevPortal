// zod の ZodType を型のみで取り込む (validateConfig 経由で実体は呼び出す)
import type { z } from "zod";
// core の検証ヘルパを取り込み (loader はファイル I/O 担当、検証は core に委譲する)
import { validateConfig } from "@k1s0-ts-config/core";
// 非同期・同期のロード本体を取り込む
import { loadConfig, loadConfigSync } from "./load.js";

// ファイルを読み込み、zod スキーマで検証して T を返す (非同期版)
// 検証失敗時は core 側から ZodError が透過する
export async function loadAndValidate<T>(
  // 読み込み対象のファイルパス
  filePath: string,
  // 検証に使う zod スキーマ
  schema: z.ZodType<T>,
): Promise<T> {
  // ファイルを unknown としてロード
  const raw = await loadConfig(filePath);
  // core の validateConfig で T 型に確定させて返す
  return validateConfig(schema, raw);
}

// 同期版: 起動時の 1 度きりロード向け
// 振る舞いは loadAndValidate と同じ
export function loadAndValidateSync<T>(
  // 読み込み対象のファイルパス
  filePath: string,
  // 検証に使う zod スキーマ
  schema: z.ZodType<T>,
): T {
  // 同期ロードで unknown を取得
  const raw = loadConfigSync(filePath);
  // core の validateConfig で T 型に確定させて返す
  return validateConfig(schema, raw);
}
