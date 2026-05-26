// js-yaml のデフォルトエクスポートからロード関数を取り込む
import { load as yamlLoad } from "js-yaml";
// loader 共通のエラークラスを取り込む
import { ConfigLoaderError } from "./errors.js";

// YAML 由来で Object.prototype を汚染しうるキー（信頼できない設定ソースを読む場合のガード）
// js-yaml は __proto__: { ... } を通常のキーとして扱うため、明示的に除去する必要がある
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// パース結果を再帰的に辿り、プロトタイプ汚染になりうるキーを取り除いた値を返す
// 配列はそのまま走査し、それ以外のプリミティブはコピーせずに返す
function stripDangerousKeys(value: unknown): unknown {
  // 配列は要素ごとに再帰
  if (Array.isArray(value)) {
    // 新しい配列を生成しつつ各要素を sanitize
    return value.map(stripDangerousKeys);
  }
  // null 以外のオブジェクトのみ走査（typeof null は object のため除外）
  if (value !== null && typeof value === "object") {
    // 安全なキーだけを集める新規オブジェクトを構築
    const safe: Record<string, unknown> = {};
    // for-of で各エントリをチェック
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // dangerous なキーはスキップ
      if (DANGEROUS_KEYS.has(k)) {
        continue;
      }
      // 値側も再帰的に sanitize して格納
      safe[k] = stripDangerousKeys(v);
    }
    // 浄化済みオブジェクトを返却
    return safe;
  }
  // プリミティブ・null はそのまま
  return value;
}

// 文字列を YAML としてパースし unknown を返す
// 失敗時は ConfigLoaderError(code=PARSE_ERROR) に包んで再 throw
//
// セキュリティ: パース後に __proto__/constructor/prototype キーを再帰的に除去し、
// js-yaml 経由のプロトタイプ汚染を防ぐ。
export function parseYaml(
  // パース対象の文字列 (UTF-8 で読み込まれた想定)
  content: string,
  // エラーメッセージに含めるための元ファイルパス (任意)
  filePath?: string,
): unknown {
  // try-catch で YAMLException を捕捉して包む
  try {
    // js-yaml の安全な (タグ拡張を許さない) ローダで読み込む
    const parsed = yamlLoad(content);
    // パース結果を sanitize してから返す
    return stripDangerousKeys(parsed);
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
