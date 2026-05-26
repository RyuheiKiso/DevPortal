// Node の path モジュールから拡張子取得関数を取り込む
import { extname } from "node:path";
// loader 共通のエラークラスを取り込む
import { ConfigLoaderError } from "./errors.js";
// JSON パーサ関数を取り込む
import { parseJson } from "./json.js";
// YAML パーサ関数を取り込む
import { parseYaml } from "./yaml.js";

// 文字列をパースするコールバックの共通型
// filePath はエラーメッセージ用 (任意)
export type ParseFn = (content: string, filePath?: string) => unknown;

// ファイルパスの拡張子からパーサ関数を解決する
// 未知の拡張子の場合は UNSUPPORTED_EXT を投げる
export function detectParser(
  // 拡張子判定の対象となるファイルパス
  filePath: string,
): ParseFn {
  // 大文字小文字を吸収するため小文字化した拡張子を取得 (例: ".json")
  const ext = extname(filePath).toLowerCase();
  // .json は JSON パーサを使用
  if (ext === ".json") {
    // JSON 用のパース関数を返す
    return parseJson;
  }
  // .yaml もしくは .yml は YAML パーサを使用
  if (ext === ".yaml" || ext === ".yml") {
    // YAML 用のパース関数を返す
    return parseYaml;
  }
  // それ以外は対応する形式が無いのでエラー
  throw new ConfigLoaderError(
    `Unsupported config file extension: ${ext || "(none)"} (file: ${filePath})`,
    "UNSUPPORTED_EXT",
  );
}
