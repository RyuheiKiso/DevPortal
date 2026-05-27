// loader 共通のエラークラスを取り込む
import { ConfigLoaderError } from "./errors.js";
// プロトタイプ汚染対策の sanitize（YAML 経路と同じガードを JSON にも適用）
import { stripDangerousKeys } from "./sanitize.js";

// 文字列を JSON としてパースし unknown を返す
// 失敗時は ConfigLoaderError(code=PARSE_ERROR) に包んで再 throw
//
// セキュリティ: JSON.parse は仕様上 `__proto__` を own data property としてセットするため
// プロトタイプ汚染は直接は発生しないが、後段で `obj[k] = parsed[k]` のような単純代入経路で
// __proto__ setter を起動する経路を塞ぐため、YAML と対称に sanitize を適用する。
export function parseJson(
  // パース対象の文字列 (UTF-8 で読み込まれた想定)
  content: string,
  // エラーメッセージに含めるための元ファイルパス (任意)
  filePath?: string,
): unknown {
  // try-catch で SyntaxError を捕捉して包む
  try {
    // 標準 JSON.parse を利用 (追加依存ゼロ)
    const parsed = JSON.parse(content);
    // sanitize してから返す（YAML と整合）
    return stripDangerousKeys(parsed);
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
