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

// FILE_NOT_FOUND メッセージで「探索した候補パスを列挙」する整形ヘルパ
// glob 風プレースホルダ (`dev.{json|yaml|yml}`) は実在パスと誤解されやすいため、
// 「Tried: A / B / C」形式に展開する
function formatTriedCandidates(dir: string, baseName: string): string {
  // 各拡張子の絶対パス候補を生成し、" / " で連結
  return ENV_EXTENSIONS.map((ext) => join(dir, `${baseName}${ext}`)).join(" / ");
}

// ensureObject の挙動を制御するオプション
interface EnsureObjectOptions {
  // 「差分なし」を意味する null/undefined を空 {} として許容するか
  // dev は false（必須ファイル）、staging/prod は true（差分なしを許容）
  allowEmpty?: boolean;
}

// 任意の値がオブジェクト (連想配列) かどうかを判定する
// mergeEnvConfig の差分側 (Partial<T>) として安全に扱うためのガード
//
// 仕様:
//   - allowEmpty=true (staging/prod 用): null/undefined → {} に正規化（差分なし扱い）
//   - allowEmpty=false (dev 用): null/undefined を PARSE_ERROR として弾く（必須ファイル）
//   - 配列・プリミティブは常に構造エラーとして PARSE_ERROR
//
// js-yaml は完全空ファイルでは undefined、`null:`/`~` では null を返す。両方を同一視する。
function ensureObject(
  value: unknown,
  filePath: string,
  options: EnsureObjectOptions = {},
): Record<string, unknown> {
  // null / undefined の扱いは allowEmpty で分岐
  if (value === null || value === undefined) {
    // 任意ファイル（staging/prod）は空マージとして {} を返す
    if (options.allowEmpty) {
      return {};
    }
    // 必須ファイル（dev）が空の場合は構造エラー
    throw new ConfigLoaderError(
      `Empty top-level value in required config (file: ${filePath})`,
      "PARSE_ERROR",
    );
  }
  // 配列やプリミティブはトップレベルが連想配列でないため構造エラー
  if (typeof value !== "object" || Array.isArray(value)) {
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
// dev は必須 (無ければ FILE_NOT_FOUND・空なら PARSE_ERROR)、staging/prod は欠けていたら {} 補完
//
// 二段構え:
//   1. dev を先に探索 → 見つからなければ即 throw（staging/prod の I/O を無駄にしない）
//   2. dev 確定後、3 ファイルの読込を並列化し allSettled で unhandled rejection を防ぐ
export async function loadEnvConfigMap(
  // 環境別ファイルが置かれているディレクトリ
  dir: string,
): Promise<EnvConfigMap<Record<string, unknown>>> {
  // 第 1 段: dev を先行探索（無ければエラー時点で staging/prod の I/O を発生させない）
  const devPath = await findEnvFile(dir, "dev");
  // dev が無ければ FILE_NOT_FOUND（候補パスを Tried 形式で列挙）
  if (devPath === undefined) {
    throw new ConfigLoaderError(
      `Config file not found. Tried: ${formatTriedCandidates(dir, "dev")}`,
      "FILE_NOT_FOUND",
    );
  }
  // 第 2 段: dev/staging/prod の読込を並列化
  // allSettled を使うことで、複数足同時失敗時の unhandled rejection を防ぐ
  const results = await Promise.allSettled([
    // dev は必須・空 NG。ensureObject に allowEmpty=false（デフォルト）を渡す
    loadConfig(devPath).then((v) => ensureObject(v, devPath)),
    // staging は任意・空 OK。先に findEnvFile してから読込
    findEnvFile(dir, "staging").then((path) =>
      // 見つからなければ {}、見つかれば読み込んで allowEmpty=true で正規化
      path === undefined
        ? ({} as Record<string, unknown>)
        : loadConfig(path).then((v) => ensureObject(v, path, { allowEmpty: true })),
    ),
    // prod も任意・空 OK
    findEnvFile(dir, "prod").then((path) =>
      // 見つからなければ {}、見つかれば読み込んで allowEmpty=true で正規化
      path === undefined
        ? ({} as Record<string, unknown>)
        : loadConfig(path).then((v) => ensureObject(v, path, { allowEmpty: true })),
    ),
  ]);
  // どれか一つでも reject していたら、その reason を最初に見つかったものから throw
  for (const r of results) {
    // status が rejected の結果を見つけ次第 throw（unhandled rejection は残らない）
    if (r.status === "rejected") {
      throw r.reason;
    }
  }
  // 全成功なので value を取り出して EnvConfigMap 形に組み立てる
  const [devRaw, stagingRaw, prodRaw] = (
    results as PromiseFulfilledResult<Record<string, unknown>>[]
  ).map((r) => r.value);
  // core の EnvConfigMap 形にまとめて返す
  return { dev: devRaw, staging: stagingRaw, prod: prodRaw };
}

// loadEnvConfigMap の同期版
// 同期版は順次 I/O のため二段構え化のメリットは小さいが、メッセージ整形と ensureObject の
// allowEmpty 仕様は非同期版と揃える
export function loadEnvConfigMapSync(
  // 環境別ファイルが置かれているディレクトリ
  dir: string,
): EnvConfigMap<Record<string, unknown>> {
  // dev ファイルを探す
  const devPath = findEnvFileSync(dir, "dev");
  // dev が無ければ FILE_NOT_FOUND（候補パスを Tried 形式で列挙）
  if (devPath === undefined) {
    throw new ConfigLoaderError(
      `Config file not found. Tried: ${formatTriedCandidates(dir, "dev")}`,
      "FILE_NOT_FOUND",
    );
  }
  // dev を読み込み（allowEmpty=false で空 NG）
  const devRaw = ensureObject(loadConfigSync(devPath), devPath);
  // staging 任意（allowEmpty=true で空 OK）
  const stagingPath = findEnvFileSync(dir, "staging");
  const stagingRaw = stagingPath === undefined
    ? {}
    : ensureObject(loadConfigSync(stagingPath), stagingPath, { allowEmpty: true });
  // prod 任意（allowEmpty=true で空 OK）
  const prodPath = findEnvFileSync(dir, "prod");
  const prodRaw = prodPath === undefined
    ? {}
    : ensureObject(loadConfigSync(prodPath), prodPath, { allowEmpty: true });
  // EnvConfigMap 形で返す
  return { dev: devRaw, staging: stagingRaw, prod: prodRaw };
}
