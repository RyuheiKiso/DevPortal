// loader 共通のエラークラスを取り込む
import { ConfigLoaderError } from "./errors.js";
// JSON パーサ関数を取り込む
import { parseJson } from "./json.js";
// YAML パーサ関数を取り込む
import { parseYaml } from "./yaml.js";

// 文字列をパースするコールバックの共通型
// filePath はエラーメッセージ用 (任意)
export type ParseFn = (content: string, filePath?: string) => unknown;

// node:path に依存せず最後のドット以降を拡張子として抽出する
// (RN/RNW 環境では node:path が必ずしも利用できないため自前で実装)
function extractExtension(filePath: string): string {
  // ファイル名部分のみ抽出 (フォワード/バックスラッシュ両対応)
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  // 最後のドット以降を取得 (ドット無しなら空文字)
  const lastDot = fileName.lastIndexOf(".");
  // ドットが見つからない、または先頭ドット (隠しファイル想定) は拡張子なしと扱う
  return lastDot <= 0 ? "" : fileName.slice(lastDot).toLowerCase();
}

// ファイルパスの拡張子からパーサ関数を解決する
// 未知の拡張子の場合は UNSUPPORTED_EXT を投げる
export function detectParser(
  // 拡張子判定の対象となるファイルパス
  filePath: string,
): ParseFn {
  // 小文字化した拡張子を取得 (例: ".json")
  const ext = extractExtension(filePath);
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
