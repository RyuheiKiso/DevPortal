// js-yaml のロード関数を取り込む
import { load as yamlLoad } from "js-yaml";
// loader 共通のエラークラスを取り込む
import { ConfigLoaderError } from "./errors.js";

// 文字列を YAML としてパースし unknown を返す
// 失敗時は ConfigLoaderError(code=PARSE_ERROR) に包んで再 throw
export function parseYaml(
  // パース対象の文字列 (UTF-8 で読み込まれた想定)
  content: string,
  // エラーメッセージに含めるための元ファイルパス (任意)
  filePath?: string,
): unknown {
  // try-catch で YAMLException を捕捉して包む
  try {
    // js-yaml の安全な (タグ拡張を許さない) ローダで読み込む
    return yamlLoad(content);
  } catch (cause) {
    // 失敗位置を伝えるためにファイルパスを含めたメッセージを組み立てる
    const where = filePath === undefined ? "" : ` (file: ${filePath})`;
    // パース失敗を共通エラーに包んで投げる (cause で元 YAMLException を保持)
    throw new ConfigLoaderError(
      `Failed to parse YAML${where}`,
      "PARSE_ERROR",
      cause,
    );
  }
}
