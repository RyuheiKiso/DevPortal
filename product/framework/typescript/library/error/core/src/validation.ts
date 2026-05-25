// AppError ファクトリを取り込み
import { createAppError } from "./appError.js";
// 型ガード・record ヘルパを取り込み
import { isRecord, readString } from "./guards.js";
// 公開型を取り込み
import type { AppError, ErrorContext, ValidationIssue } from "./types.js";

// path フィールドが (string | number)[] かを判定する
function isPath(value: unknown): value is readonly (string | number)[] {
  // 配列かつ各要素が string か number のときだけ真
  return Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number");
}

// Zod 風 issues 配列を AppError 用の ValidationIssue[] に変換する
// 入力が想定外なら空配列を返し、呼び出し側で「検証エラーではない」と判断できる
export function extractValidationIssues(value: unknown): readonly ValidationIssue[] {
  // object でない、または issues プロパティが配列でなければ空とみなす
  if (!isRecord(value) || !Array.isArray(value.issues)) {
    return [];
  }

  // issues を順に検査して妥当な要素だけ採用する
  return value.issues
    .map((issue): ValidationIssue | null => {
      // 各要素は object であることが必要
      if (!isRecord(issue)) {
        return null;
      }
      // message は必須（無い要素は無効）
      const message = readString(issue, "message");
      if (message === undefined) {
        return null;
      }
      // path は (string | number)[] のときだけ採用
      const path = isPath(issue.path) ? issue.path : undefined;
      // 採用するフィールドを限定して新規 object を返す
      return {
        path,
        code: readString(issue, "code"),
        message,
      };
    })
    .filter((issue): issue is ValidationIssue => issue !== null);
}

// fromValidationError に渡せる追加オプション（normalize 側の includeCause を反映するための受け口）
export interface FromValidationErrorOptions {
  // cause を保持するか（false で破棄して循環参照やシリアライズ不能値を避ける）
  includeCause?: boolean;
}

// 検証エラー風オブジェクトから AppError を生成する
// userMessage は最初の issue のメッセージを採用（フォーム単位の表示に有用）
export function fromValidationError(
  error: unknown,
  context?: ErrorContext,
  options?: FromValidationErrorOptions,
): AppError {
  // 入力から issues を抽出
  const issues = extractValidationIssues(error);
  // 先頭 issue を取り出し（userMessage の元として利用）
  const firstIssue = issues[0];
  // 内部 message は元の error.message を流用、無ければ汎用文言
  const message = isRecord(error) && typeof error.message === "string" ? error.message : "Validation failed";
  // includeCause は明示 false 指定のときだけ破棄、未指定は true 扱い（既存呼び出し側の挙動を破壊しない）
  const includeCause = options?.includeCause !== false;
  return createAppError({
    // validation kind 固定
    kind: "validation",
    // 内部メッセージ
    message,
    // ユーザー向けは先頭 issue の message を採用、無ければ既定文言
    userMessage: firstIssue?.message ?? "Please check the entered values.",
    // details に元の error をそのまま保持
    details: error,
    // cause は includeCause が true のときだけ元の error を保持（false なら undefined にして循環参照を回避）
    cause: includeCause ? error : undefined,
    // 検証エラーはユーザー入力起因なので運用監視への通報は不要
    reportable: false,
    // issues が 1 件以上あれば配列を保持
    validationIssues: issues.length > 0 ? issues : undefined,
    // 付随コンテキスト
    context,
  });
}
