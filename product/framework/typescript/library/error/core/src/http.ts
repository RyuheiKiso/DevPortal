// AppError ファクトリと kind 分類ロジックを取り込み
import { createAppError } from "./appError.js";
import { classifyErrorCode, classifyHttpStatus } from "./classify.js";
// オブジェクト型・型ガードヘルパを取り込み
import { isRecord, readNumber } from "./guards.js";
// HTTP レスポンス内に含まれる zod 風 issues を抽出するヘルパを取り込み
import { extractValidationIssues } from "./validation.js";
// 公開型を取り込み
import type { AppError, ErrorContext, HttpErrorLike } from "./types.js";

// readHeader が許容するヘッダ形状（Web Headers / plain object / 未指定）
type HeadersLike = Headers | Record<string, string | undefined> | undefined;

// ヘッダ名で値を取り出すヘルパ
// 呼び出し側は常に小文字キーで来る前提で、Web Headers の case-insensitive lookup を活用する
function readHeader(headers: HeadersLike, name: string): string | undefined {
  // 未指定なら検索対象が無い
  if (headers === undefined) {
    return undefined;
  }
  // Web Headers クラスは大小無視で取得できる
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  // plain object は直接アクセス（呼び出し側が小文字で揃えている前提）
  if (isRecord(headers)) {
    const value = headers[name];
    return typeof value === "string" ? value : undefined;
  }
  // Headers でも record でもない値（null / 配列 / 数値など）は無視
  return undefined;
}

// HTTP エラー風オブジェクトかを判定する（status / statusCode / response のいずれかを必須）
export function isHttpErrorLike(value: unknown): value is HttpErrorLike {
  // object 以外は HTTP エラーとして扱わない
  if (!isRecord(value)) {
    return false;
  }
  // status / statusCode / response のいずれかを持つものだけを HTTP 系として扱う
  return (
    readNumber(value, "status") !== undefined ||
    readNumber(value, "statusCode") !== undefined ||
    isRecord(value.response)
  );
}

// fromHttpError に渡せる追加オプション（normalize 側の includeCause を反映するための受け口）
export interface FromHttpErrorOptions {
  // cause を保持するか（false で破棄して循環参照やシリアライズ不能値を避ける）
  includeCause?: boolean;
}

// HTTP エラー風オブジェクトから AppError を生成する
export function fromHttpError(
  error: HttpErrorLike,
  context?: ErrorContext,
  options?: FromHttpErrorOptions,
): AppError {
  // response が record のときだけ取り出す
  const response = isRecord(error.response) ? error.response : undefined;
  // response.status を有限数として取り出す（無ければ undefined）
  const responseStatus = response === undefined ? undefined : readNumber(response, "status");
  // 上位 status / statusCode / response.status の順で解決
  const status = error.status ?? error.statusCode ?? responseStatus;
  // 詳細コード（HttpErrorLike 型で string | undefined として保証済み）
  const code = error.code;
  // status から kind を決め、無ければ code から推定し、それも無ければ汎用 http
  const kind = typeof status === "number" ? classifyHttpStatus(status) : (classifyErrorCode(code) ?? "http");
  // headers を HeadersLike として取り出す
  const headers: HeadersLike = response?.headers;
  // request-id をプロパティ → ヘッダ → context の順で解決
  const requestId = error.requestId ?? readHeader(headers, "x-request-id") ?? context?.requestId;
  // trace-id をプロパティ → ヘッダ → context の順で解決
  const traceId = error.traceId ?? readHeader(headers, "traceparent") ?? context?.traceId;
  // details が無ければ response.body → response.data の順で埋める
  const details = error.details ?? response?.body ?? response?.data;
  // body / data / error 自身に zod 風 issues 配列があれば抽出して validationIssues に併設する
  // これにより HTTP 422 などで kind=validation になるケースでも status / requestId / traceId を失わずに済む
  const issuesSource = response?.body ?? response?.data ?? error;
  // extractValidationIssues は配列を返す（issues 構造が無ければ空配列）
  const validationIssues = extractValidationIssues(issuesSource);
  // includeCause は明示 false 指定のときだけ破棄、未指定は true 扱い（既存呼び出し側の挙動を破壊しない）
  const includeCause = options?.includeCause !== false;
  // 上で集めた値で AppError を生成（cause は元 error.cause のみ採用し、自己参照は作らない）
  return createAppError({
    kind,
    message: error.message ?? `HTTP request failed${typeof status === "number" ? ` with status ${status}` : ""}`,
    code,
    status,
    requestId,
    traceId,
    details,
    // includeCause=false なら error.cause も含めて undefined に揃え、循環参照や非 JSON 化値を抑止する
    cause: includeCause ? error.cause : undefined,
    // 空配列は意味が無いので undefined に正規化する
    validationIssues: validationIssues.length > 0 ? validationIssues : undefined,
    context,
  });
}
