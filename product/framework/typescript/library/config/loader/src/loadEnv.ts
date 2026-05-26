// Node の fs/path API を取り込む
import { access } from "node:fs/promises";
import { accessSync } from "node:fs";
import { join } from "node:path";
// EnvConfigMap 型を core から取り込み (mergeEnvConfig にそのまま渡せる形を返すため)
import type { EnvConfigMap } from "@k1s0-ts-config/core";
// loader 共通のエラークラスを取り込む
import { ConfigLoaderError } from "./errors.js";
// 非同期・同期のロード本体を取り込む
import { loadConfig, loadConfigSync } from "./load.js";

// 環境別ファイルを探す際に試す拡張子の優先順 (JSON > YAML > YML)
const ENV_EXTENSIONS = [".json", ".yaml", ".yml"] as const;

// dir 配下から baseName.<ext> を非同期で探し、存在すれば絶対パスを返す
// どの拡張子のファイルも見つからない場合は undefined を返す
async function findEnvFile(dir: string, baseName: string): Promise<string | undefined> {
  // 候補拡張子を順番に試す (先勝ち)
  for (const ext of ENV_EXTENSIONS) {
    // 結合パスを組み立てる
    const candidate = join(dir, `${baseName}${ext}`);
    // ファイル存在を確認する (失敗例外は次の候補へ進む)
    try {
      // 読み込み可能なら見つかったとみなす
      await access(candidate);
      // パスを返して終了
      return candidate;
    } catch {
      // ENOENT 等は無視して次の拡張子へ
    }
  }
  // どれも見つからなかった
  return undefined;
}

// findEnvFile の同期版
function findEnvFileSync(dir: string, baseName: string): string | undefined {
  // 候補拡張子を順番に試す
  for (const ext of ENV_EXTENSIONS) {
    // 結合パスを組み立てる
    const candidate = join(dir, `${baseName}${ext}`);
    // 存在確認 (失敗は次の候補へ)
    try {
      // 同期 access を使う
      accessSync(candidate);
      // 見つかったら返す
      return candidate;
    } catch {
      // 次の拡張子へ
    }
  }
  // どれも無し
  return undefined;
}

// 任意の値がオブジェクト (連想配列) かどうかを判定する
// mergeEnvConfig の差分側 (Partial<T>) として安全に扱うためのガード
function ensureObject(value: unknown, filePath: string): Record<string, unknown> {
  // null と非オブジェクト (配列含む扱いは別) を弾く
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    // 形式違いはパース後の構造エラーとして PARSE_ERROR に分類
    throw new ConfigLoaderError(
      `Expected object at top level (file: ${filePath})`,
      "PARSE_ERROR",
    );
  }
  // オブジェクトとして再キャストして返す
  return value as Record<string, unknown>;
}

// dir 配下の dev / staging / prod 設定ファイルを読み込んで EnvConfigMap<unknown> を返す
// dev は必須 (無ければ FILE_NOT_FOUND)、staging/prod は欠けていたら {} 補完
export async function loadEnvConfigMap(
  // 環境別ファイルが置かれているディレクトリ
  dir: string,
): Promise<EnvConfigMap<Record<string, unknown>>> {
  // dev ファイルを探す
  const devPath = await findEnvFile(dir, "dev");
  // dev が無ければファイル未存在として扱う
  if (devPath === undefined) {
    // 期待するパス候補を伝えるため最初の候補をメッセージに含める
    throw new ConfigLoaderError(
      `Config file not found: ${join(dir, "dev.{json|yaml|yml}")}`,
      "FILE_NOT_FOUND",
    );
  }
  // dev は必須なのでまず読み込む
  const devRaw = ensureObject(await loadConfig(devPath), devPath);
  // staging は欠けていたら {} 扱い
  const stagingPath = await findEnvFile(dir, "staging");
  const stagingRaw = stagingPath === undefined ? {} : ensureObject(await loadConfig(stagingPath), stagingPath);
  // prod も欠けていたら {} 扱い
  const prodPath = await findEnvFile(dir, "prod");
  const prodRaw = prodPath === undefined ? {} : ensureObject(await loadConfig(prodPath), prodPath);
  // core の EnvConfigMap 形にまとめて返す
  return { dev: devRaw, staging: stagingRaw, prod: prodRaw };
}

// loadEnvConfigMap の同期版
export function loadEnvConfigMapSync(
  // 環境別ファイルが置かれているディレクトリ
  dir: string,
): EnvConfigMap<Record<string, unknown>> {
  // dev ファイルを探す
  const devPath = findEnvFileSync(dir, "dev");
  // dev が無ければ FILE_NOT_FOUND
  if (devPath === undefined) {
    throw new ConfigLoaderError(
      `Config file not found: ${join(dir, "dev.{json|yaml|yml}")}`,
      "FILE_NOT_FOUND",
    );
  }
  // dev を読み込み
  const devRaw = ensureObject(loadConfigSync(devPath), devPath);
  // staging 任意
  const stagingPath = findEnvFileSync(dir, "staging");
  const stagingRaw = stagingPath === undefined ? {} : ensureObject(loadConfigSync(stagingPath), stagingPath);
  // prod 任意
  const prodPath = findEnvFileSync(dir, "prod");
  const prodRaw = prodPath === undefined ? {} : ensureObject(loadConfigSync(prodPath), prodPath);
  // EnvConfigMap 形で返す
  return { dev: devRaw, staging: stagingRaw, prod: prodRaw };
}
