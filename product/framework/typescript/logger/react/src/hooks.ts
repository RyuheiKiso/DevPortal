// React の hook を取り込み
import { useContext, useRef } from "react";
// core の Logger 型を取り込み
import type { Logger, LoggerBindings } from "@k1s0-ts-logger/core";
// Context を取り込み
import { LoggerContext } from "./context.js";

// Context から Logger を取り出す。Provider 外で呼ばれた場合は明示エラー
export function useLogger(): Logger {
  // Context 値を取得
  const logger = useContext(LoggerContext);
  // Provider が無いときは即エラー（実装ミスを早期発見）
  if (logger === null) {
    throw new Error("useLogger must be called inside <LoggerProvider>");
  }
  // 取得した Logger を返す
  return logger;
}

// tags 配列の浅い等価判定
function tagsEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  // 両方 undefined なら等価
  if (a === b) return true;
  // 片方だけ undefined なら不一致
  if (a === undefined || b === undefined) return false;
  // 長さが違えば不一致
  if (a.length !== b.length) return false;
  // 各要素を順に比較（Object.is で NaN/±0 も安全に判定）
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  // すべて一致
  return true;
}

// context オブジェクトの浅い等価判定（キー集合 + 各値を Object.is で比較）
function contextEqual(
  a: Readonly<Record<string, unknown>> | undefined,
  b: Readonly<Record<string, unknown>> | undefined,
): boolean {
  // 両方 undefined なら等価
  if (a === b) return true;
  // 片方だけ undefined なら不一致
  if (a === undefined || b === undefined) return false;
  // キー集合を比較
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  // 各キーの値を比較
  for (const k of aKeys) {
    // b に同じキーがあり、値も一致するか
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Object.is(a[k], b[k])) return false;
  }
  // すべて一致
  return true;
}

// 親 Logger に追加バインディングを加えた派生 Logger を返す
// useRef ベースで前回値と構造比較し、変化があるときだけ child を再生成（JSON.stringify を使わない）
export function useScopedLogger(scope: string | LoggerBindings): Logger {
  // 親 Logger を取得
  const parent = useLogger();
  // 引数を bindings 形式へ正規化（文字列はタグ 1 件として扱う）
  const bindings: LoggerBindings = typeof scope === "string" ? { tags: [scope] } : scope;
  // 前回の bindings と child Logger、parent 参照を保持する ref
  const cacheRef = useRef<{
    parent: Logger;
    bindings: LoggerBindings;
    child: Logger;
  } | null>(null);
  // キャッシュが無いか、parent / tags / context のいずれかが変わったら child を再生成
  if (
    cacheRef.current === null ||
    cacheRef.current.parent !== parent ||
    !tagsEqual(cacheRef.current.bindings.tags, bindings.tags) ||
    !contextEqual(cacheRef.current.bindings.context, bindings.context)
  ) {
    // 派生 Logger を生成して ref に保存
    cacheRef.current = { parent, bindings, child: parent.child(bindings) };
  }
  // キャッシュ済み child を返す
  return cacheRef.current.child;
}
