// loader 共通のエラークラスを取り込む
import { ConfigLoaderError } from "./errors.js";

// 文字列を JSON としてパースし unknown を返す
// 失敗時は ConfigLoaderError(code=PARSE_ERROR) に包んで再 throw
export function parseJson(
  // パース対象の文字列 (UTF-8 で読み込まれた想定)
  content: string,
  // エラーメッセージに含めるための元ファイルパス (任意)
  filePath?: string,
): unknown {
  // try-catch で SyntaxError を捕捉して包む
  try {
    // 標準 JSON.parse を利用 (追加依存ゼロ)
    return JSON.parse(content);
  } catch (cause) {
    // 失敗位置を伝えるためにファイルパスを含めたメッセージを組み立てる
    const where = filePath === undefined ? "" : ` (file: ${filePath})`;
    // パース失敗を共通エラーに包んで投げる (cause で元 SyntaxError を保持)
    throw new ConfigLoaderError(
      `Failed to parse JSON${where}`,
      "PARSE_ERROR",
      cause,
    );
  }
}
