// パース結果を再帰的に走査し、プロトタイプ汚染になりうるキーを除去する sanitizer
// 主に YAML / JSON のパース結果を信頼領域に取り込む前のガードとして使う
// 共通化: loader 内の yaml.ts と json.ts の両方からこの関数を参照する
// （rn-loader 側にも同等の sanitize.ts を別ファイルで保持し、パッケージ間 dep を増やさない方針）

// 削除対象キー: __proto__ / constructor / prototype（プロトタイプ汚染ベクタ）
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// strip 対象外として「型情報を保持したい」ビルトインオブジェクトを判定する
// js-yaml の DEFAULT_SCHEMA は !!timestamp で Date、!!binary で Buffer/Uint8Array を返すため、
// これらを再帰で空 {} に潰さないようガードする
function shouldPreserve(value: object): boolean {
  // Date は時刻情報、Map/Set はコレクション意味論、RegExp はパターン、TypedArray/Buffer はバイナリ
  return (
    // 時刻インスタンス
    value instanceof Date ||
    // キー付きコレクション
    value instanceof Map ||
    // 値集合
    value instanceof Set ||
    // 正規表現
    value instanceof RegExp ||
    // TypedArray / DataView / Buffer などのバイナリビュー
    ArrayBuffer.isView(value) ||
    // 生 ArrayBuffer
    value instanceof ArrayBuffer
  );
}

// 内部実装: visited WeakSet で循環参照を検知しつつ走査
// 循環ノードに 2 度目に遭遇したらそのまま返す（無限再帰防止）
function walk(value: unknown, visited: WeakSet<object>): unknown {
  // 配列は要素ごとに再帰
  if (Array.isArray(value)) {
    // 循環検知: 既に訪問済みなら同じ配列を返してループを断つ
    if (visited.has(value)) {
      return value;
    }
    // visited に登録
    visited.add(value);
    // 各要素を sanitize した新規配列を生成
    return value.map((v) => walk(v, visited));
  }
  // プリミティブ・null・undefined はそのまま返す
  if (value === null || typeof value !== "object") {
    return value;
  }
  // 特殊型は型情報を保持して返す（Date/Map/Set/RegExp/Buffer/TypedArray など）
  if (shouldPreserve(value)) {
    return value;
  }
  // 循環検知: プレーンオブジェクトでも自己参照は再入を断つ
  if (visited.has(value)) {
    return value;
  }
  // visited に登録
  visited.add(value);
  // 安全なキーだけを集める新規オブジェクトを構築
  const safe: Record<string, unknown> = {};
  // for-of でエントリを走査（Object.entries は own enumerable string キーのみ）
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // dangerous なキーはスキップ
    if (DANGEROUS_KEYS.has(k)) {
      continue;
    }
    // 値側も再帰的に sanitize
    safe[k] = walk(v, visited);
  }
  // 浄化済みオブジェクトを返却
  return safe;
}

// 公開 API: パース結果に対して dangerous キーを除去した値を返す
// 循環参照入力でも StackOverflow せず安全に終了する
export function stripDangerousKeys(value: unknown): unknown {
  // 新規 WeakSet を visited として渡し、各呼び出しの状態を独立させる
  return walk(value, new WeakSet());
}
