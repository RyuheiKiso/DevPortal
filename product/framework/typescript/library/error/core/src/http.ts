// AppError ファクトリと kind 分類ロジックを取り込み
import { createAppError } from "./appError.js";
import { classifyErrorCode, classifyHttpStatus } from "./classify.js";
// オブジェクト型・型ガードヘルパを取り込み
import { isRecord, readNumber } from "./guards.js";
// HTTP レスポンス内に含まれる zod 風 issues を抽出するヘルパを取り込み
import { extractValidationIssues } from "./validation.js";
// 公開型を取り込み
import type { AppError, ErrorContext, HttpErrorLike } from "./types.js";

// 非空文字列のみを採用するヘルパ
// HttpErrorLike の各 string プロパティは型上 string | undefined だが、
// 実行時に空文字列 "" が来た場合は意味のない値として undefined に揃え、
// chain 内の ?? フォールバックが正常に効くようにする
function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// readHeader が許容するヘッダ形状（Web Headers / plain object / 未指定）
type HeadersLike = Headers | Record<string, string | undefined> | undefined;

// ヘッダ名で値を取り出すヘルパ
// 呼び出し側は常に小文字キーで来る前提で、Web Headers の case-insensitive lookup を活用する
// 空文字列のヘッダ値は意味のない値として undefined に正規化し、後続の ?? フォールバックを通す
function readHeader(headers: HeadersLike, name: string): string | undefined {
  // 未指定なら検索対象が無い
  if (headers === undefined) {
    return undefined;
  }
  // Web Headers クラスは大小無視で取得できる
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    // headers.get は欠落時 null・値が空文字列のときも "" を返すため、nonEmpty で両方 undefined に寄せる
    return nonEmpty(headers.get(name) ?? undefined);
  }
  // plain object は直接アクセス（呼び出し側が小文字で揃えている前提）
  if (isRecord(headers)) {
    const value = headers[name];
    // string 型のみ採用しつつ、空文字列は undefined に正規化
    return typeof value === "string" ? nonEmpty(value) : undefined;
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
  // 詳細コード（HttpErrorLike 型で string | undefined だが、空文字列は意味の無い値として undefined に揃える）
  const code = nonEmpty(error.code);
  // status から kind を決め、無ければ code から推定し、それも無ければ汎用 http
  const kind = typeof status === "number" ? classifyHttpStatus(status) : (classifyErrorCode(code) ?? "http");
  // headers を HeadersLike として取り出す
  const headers: HeadersLike = response?.headers;
  // request-id をプロパティ → ヘッダ → context の順で解決（プロパティの空文字列は nonEmpty で弾く）
  const requestId = nonEmpty(error.requestId) ?? readHeader(headers, "x-request-id") ?? context?.requestId;
  // trace-id をプロパティ → ヘッダ → context の順で解決（プロパティの空文字列は nonEmpty で弾く）
  const traceId = nonEmpty(error.traceId) ?? readHeader(headers, "traceparent") ?? context?.traceId;
  // details が無ければ response.body → response.data の順で埋める
  const details = error.details ?? response?.body ?? response?.data;
  // body / data / error 自身に zod 風 issues 配列があれば抽出して validationIssues に併設する
  // これにより HTTP 422 などで kind=validation になるケースでも status / requestId / traceId を失わずに済む
  const issuesSource = response?.body ?? response?.data ?? error;
  // extractValidationIssues は配列を返す（issues 構造が無ければ空配列）
  const validationIssues = extractValidationIssues(issuesSource);
  // includeCause は明示 false 指定のときだけ破棄、未指定は true 扱い（既存呼び出し側の挙動を破壊しない）
  const includeCause = options?.includeCause !== false;
  // message は明示指定された非空文字列を優先し、未指定または空文字列ならデフォルトテンプレを採用
  // 既存挙動では `error.message ?? デフォルト` の ?? が空文字列を弾けず、空メッセージが AppError に流れていた
  const message = nonEmpty(error.message) ?? `HTTP request failed${typeof status === "number" ? ` with status ${status}` : ""}`;
  // 上で集めた値で AppError を生成（cause は元 error.cause のみ採用し、自己参照は作らない）
  return createAppError({
    kind,
    message,
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
