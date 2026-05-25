// AppError ファクトリと既定値ヘルパを取り込み
import { createAppError } from "./appError.js";
// code 由来の kind 推定ロジックを取り込み
import { classifyErrorCode } from "./classify.js";
// 型ガード・record ヘルパを取り込み
import { isAppError, isRecord, readString } from "./guards.js";
// HTTP エラー判定と HTTP 由来 AppError を取り込み
import { fromHttpError, isHttpErrorLike } from "./http.js";
// 検証エラー由来の AppError と issue 抽出を取り込み
import { fromValidationError, extractValidationIssues } from "./validation.js";
// 公開型を取り込み
import type { AppError, ErrorContext, NormalizeOptions } from "./types.js";

// NormalizeOptions から ErrorContext を取り出す（context として有効な値が無ければ undefined）
function contextFromOptions(options: NormalizeOptions): ErrorContext | undefined {
  // context として公開する項目だけを取り出す
  const { operation, component, requestId, traceId, tags, metadata } = options;
  // すべて未指定なら空 object を残さない
  if (
    operation === undefined &&
    component === undefined &&
    requestId === undefined &&
    traceId === undefined &&
    tags === undefined &&
    metadata === undefined
  ) {
    return undefined;
  }
  // 指定された context 情報を返す
  return { operation, component, requestId, traceId, tags, metadata };
}

// 既存 AppError の context と options 由来 context を選択戦略に従って合成する
// - "preserveExisting": 既存 context があればそれを優先（旧挙動）
// - "shallowMerge" (既定): top-level key の shallow merge（既存 AppError 側の値が勝つ）
function mergeContext(
  existing: ErrorContext | undefined,
  incoming: ErrorContext | undefined,
  strategy: "preserveExisting" | "shallowMerge",
): ErrorContext | undefined {
  // 旧挙動: 既存 context があれば options 由来を採用しない
  if (strategy === "preserveExisting") {
    return existing ?? incoming;
  }
  // どちらも未指定なら undefined を保つ
  if (existing === undefined && incoming === undefined) {
    return undefined;
  }
  // 片方しか無ければそのまま採用
  if (existing === undefined) {
    return incoming;
  }
  if (incoming === undefined) {
    return existing;
  }
  // 両方ある場合は shallow merge（既存 AppError 側の値が勝つ）
  // tags / metadata は深いレベルではマージしない（仕様として shallow に固定）
  return { ...incoming, ...existing };
}

// 任意の例外値を AppError に正規化するエントリポイント
// 分岐順:
//   1. 既存 AppError → context 補完して返す
//   2. HTTP-like → fromHttpError（内部で validation issues も併設）
//   3. validation-only コンテナ (HTTP 形状を持たない zod 風) → fromValidationError
//   4. Error instance → 既存ロジック
//   5. plain object → 既存ロジック
//   6. primitive → 既存ロジック
export function normalizeError(error: unknown, options: NormalizeOptions = {}): AppError {
  // options から渡された context を抽出（無ければ undefined）
  const context = contextFromOptions(options);
  // cause を保持するか（false 指定時のみ破棄、それ以外は保持）
  const includeCause = options.includeCause !== false;
  // context 合成戦略（既定 "shallowMerge"）
  const contextStrategy = options.contextStrategy ?? "shallowMerge";

  // すでに AppError であればそのまま返す（context と request/trace ID のみ補完）
  if (isAppError(error)) {
    // context は選択戦略に従って合成する
    const mergedContext = mergeContext(error.context, context, contextStrategy);
    return {
      ...error,
      context: mergedContext,
      // requestId / traceId は既存値優先、欠落していれば options 由来で補完
      requestId: error.requestId ?? context?.requestId,
      traceId: error.traceId ?? context?.traceId,
    };
  }

  // HTTP エラー風オブジェクトは HTTP 由来の AppError として処理（issues 併設は fromHttpError 内で対応）
  if (isHttpErrorLike(error)) {
    // includeCause を明示渡しすることで HTTP 経路でも cause 破棄が効くようにする
    return fromHttpError(error, context, { includeCause });
  }

  // HTTP 形状を持たない zod 風 issues コンテナは検証エラーとして処理
  if (extractValidationIssues(error).length > 0) {
    // includeCause を明示渡しすることで validation 経路でも cause 破棄が効くようにする
    return fromValidationError(error, context, { includeCause });
  }

  // 標準 Error instance は cause / code を引き継いで正規化
  if (error instanceof Error) {
    // code フィールドを持つ拡張 Error も想定し型を絞り込む
    const record = error as Error & { code?: string; cause?: unknown };
    // code が string のときだけ採用
    const code = typeof record.code === "string" ? record.code : undefined;
    return createAppError({
      kind: classifyErrorCode(code) ?? options.defaultKind ?? "unknown",
      message: error.message,
      userMessage: options.defaultUserMessage,
      code,
      cause: includeCause ? (record.cause ?? error) : undefined,
      context,
    });
  }

  // それ以外の object（throw された plain object）は details にそのまま積む
  if (isRecord(error)) {
    // code フィールドがあれば kind 推定に使う
    const code = readString(error, "code");
    // message フィールドが無ければ汎用メッセージを使う
    const message = readString(error, "message") ?? "Non-error object was thrown";
    return createAppError({
      kind: classifyErrorCode(code) ?? options.defaultKind ?? "unknown",
      message,
      userMessage: options.defaultUserMessage,
      code,
      details: error,
      cause: includeCause ? error : undefined,
      context,
    });
  }

  // primitive（string / number / null / undefined など）は最小情報で AppError 化
  return createAppError({
    kind: options.defaultKind ?? "unknown",
    message: typeof error === "string" ? error : "Unknown thrown value",
    userMessage: options.defaultUserMessage,
    details: error,
    cause: includeCause ? error : undefined,
    context,
  });
}
