// Node の fs から非同期版・同期版の読み取り関数を取り込む
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
// 拡張子からパーサを選ぶユーティリティを取り込む
import { detectParser } from "./detect.js";
// loader 共通のエラークラスを取り込む
import { ConfigLoaderError } from "./errors.js";

// I/O 系の例外を ConfigLoaderError に包んで投げ直す
// ENOENT は FILE_NOT_FOUND、それ以外 (および errno を持たない値) は IO_ERROR にマップする
function rethrowIoError(cause: unknown, filePath: string): never {
  // 値から errno コード文字列を安全に取り出す (非オブジェクト・null は undefined になる)
  // 二重キャストにより unknown からプロパティアクセス可能な型に変換し、optional chaining で防御する
  const code = (cause as { code?: unknown } | null | undefined)?.code;
  // ENOENT は専用コードに分岐 (呼び出し側がファイル不在を判定しやすくするため)
  if (code === "ENOENT") {
    // ファイル不在として再 throw
    throw new ConfigLoaderError(
      `Config file not found: ${filePath}`,
      "FILE_NOT_FOUND",
      cause,
    );
  }
  // それ以外の I/O 失敗は IO_ERROR にまとめる
  throw new ConfigLoaderError(
    `I/O error while reading config file: ${filePath}`,
    "IO_ERROR",
    cause,
  );
}

// ファイルパスを受け取り、内容をパースして unknown を返す (非同期版)
// 拡張子から JSON/YAML を自動判別する
export async function loadConfig(
  // 読み込み対象のファイル絶対パスまたは相対パス
  filePath: string,
): Promise<unknown> {
  // 拡張子からパーサを先に決定する (未知拡張子は ここで UNSUPPORTED_EXT が飛ぶ)
  const parse = detectParser(filePath);
  // ファイル読み込みは I/O 例外を包む対象なので try-catch で囲む
  let content: string;
  try {
    // UTF-8 で文字列として読み込む (バイナリ非対応)
    content = await readFile(filePath, "utf8");
  } catch (cause) {
    // ENOENT/それ以外を ConfigLoaderError に包んで再 throw
    rethrowIoError(cause, filePath);
  }
  // パース結果を返す (PARSE_ERROR はパーサ側で包まれる)
  return parse(content, filePath);
}

// 同期版: 起動時に 1 度だけ読み込みたいケース向け
// 振る舞いは loadConfig と同じだが Promise を返さない
export function loadConfigSync(
  // 読み込み対象のファイルパス
  filePath: string,
): unknown {
  // 拡張子からパーサを先に決定する
  const parse = detectParser(filePath);
  // ファイル読み込みの try-catch
  let content: string;
  try {
    // 同期 API で UTF-8 文字列として読み込む
    content = readFileSync(filePath, "utf8");
  } catch (cause) {
    // 非同期版と同じ分岐ロジックで包む
    rethrowIoError(cause, filePath);
  }
  // パース結果を同期的に返す
  return parse(content, filePath);
}
