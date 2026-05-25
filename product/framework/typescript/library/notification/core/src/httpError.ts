// 公開型を取り込み（実体コードは生成しない）
import type { NotificationLevel, ToastInput } from "./types.js";

// @k1s0-ts-http/core を runtime 依存にしないための duck typed 受け入れ形状
// HttpError 本体を import せず、最低限のフィールドだけを構造的型でマッチさせる
//
// 注: `isHttpErrorLike` の type guard を通すには下記の `retryable: boolean` が必要。
// `fromHttpError` 直接呼び出しでは retryable 不在の値でも受け付ける（interface は optional のまま維持）。
export interface HttpErrorLike {
  // 例外メッセージ（必須）
  message: string;
  // エラーコード（"NETWORK" / "TIMEOUT" / "ABORTED" 等のドメイン語彙）
  code?: string;
  // HTTP ステータス（4xx/5xx）
  status?: number;
  // リクエスト相関 ID（log と紐付ける用）
  requestId?: string;
  // 再試行可能フラグ（UI で再実行ボタン出すかどうかの判断材料、HttpError 正典では必須）
  retryable?: boolean;
}

// 任意の値が HttpErrorLike 形状にマッチするかを判定する type guard
// HttpError 正典（@k1s0-ts-http/core）の必須フィールドである retryable: boolean の存在も要求する
// （これにより Node の errno error 等 `code: string` を持つ非 HTTP error の誤分類を防ぐ）
export function isHttpErrorLike(value: unknown): value is HttpErrorLike {
  // null / プリミティブは早期に弾く
  if (value === null || typeof value !== "object") {
    return false;
  }
  // 文字列キー → unknown のレコードとして扱う
  const candidate = value as Record<string, unknown>;
  // message は必須（string でなければ HttpError ではない）
  if (typeof candidate.message !== "string") {
    return false;
  }
  // retryable: boolean は HttpError 正典で必須なので duck typing の brand として要求する
  if (typeof candidate.retryable !== "boolean") {
    return false;
  }
  // status が数値なら HttpError 由来とみなせる
  const hasStatus = typeof candidate.status === "number";
  // code が文字列でも HttpError 由来とみなせる
  const hasCode = typeof candidate.code === "string";
  // どちらかが揃っていれば true（message + retryable 単独では誤検出のリスクがあるため）
  return hasStatus || hasCode;
}

// resolveDefaultMapping が返す 1 件分のマッピング情報
export interface ErrorMappingEntry {
  // toast に表示するタイトル文字列
  title: string;
  // toast の重要度
  level: NotificationLevel;
}

// fromHttpError の振る舞いを上書きするためのオプション
export interface FromHttpErrorOptions {
  // タイトルと本文を呼出側で決め直すリゾルバ（未指定なら既定マッピングを使う）
  messageResolver?: (err: HttpErrorLike) => { title?: string; message?: string };
  // レベルを呼出側で決め直すリゾルバ（未指定なら既定マッピングを使う）
  levelResolver?: (err: HttpErrorLike) => NotificationLevel;
  // toast に追加で乗せるメタデータ（requestId 等は既定で乗るのでマージされる）
  meta?: Readonly<Record<string, unknown>>;
  // toast の duration（ms）。未指定なら NotificationManager の defaultDuration が使われる
  duration?: number;
  // 同一エラーで toast を 1 件に集約するための dedupeKey
  dedupeKey?: string;
}

// HttpErrorLike から「タイトル + レベル」の既定マッピングを引き当てる
export function resolveDefaultMapping(err: HttpErrorLike): ErrorMappingEntry {
  // ネットワーク疎通エラーは警告レベルで表示
  if (err.code === "NETWORK") {
    return { level: "warning", title: "ネットワーク接続を確認してください" };
  }
  // タイムアウトも警告レベル
  if (err.code === "TIMEOUT") {
    return { level: "warning", title: "通信がタイムアウトしました" };
  }
  // 利用者キャンセル等の中断は情報レベル
  if (err.code === "ABORTED") {
    return { level: "info", title: "操作がキャンセルされました" };
  }
  // 以降は HTTP ステータスで分岐
  const status = err.status;
  // 5xx 系はサーバ起因のエラー
  if (typeof status === "number" && status >= 500) {
    return { level: "error", title: "サーバーエラーが発生しました" };
  }
  // 認証要求
  if (status === 401) {
    return { level: "warning", title: "認証が必要です" };
  }
  // 認可エラー
  if (status === 403) {
    return { level: "warning", title: "権限がありません" };
  }
  // 対象が見つからない
  if (status === 404) {
    return { level: "warning", title: "リソースが見つかりません" };
  }
  // 残りの 4xx は汎用のリクエストエラー
  if (typeof status === "number" && status >= 400) {
    return { level: "warning", title: "リクエストエラー" };
  }
  // どの条件にも当てはまらない場合の最終フォールバック
  return { level: "error", title: "エラーが発生しました" };
}

// HttpErrorLike から ToastInput を組み立てる
export function fromHttpError(err: HttpErrorLike, options: FromHttpErrorOptions = {}): ToastInput {
  // 既定マッピング（タイトルとレベル）を取得
  const mapped = resolveDefaultMapping(err);
  // タイトル/本文の上書き候補（未指定なら空オブジェクト）
  const resolved = options.messageResolver?.(err) ?? {};
  // タイトルは resolver の値 > 既定マッピング
  const title = resolved.title ?? mapped.title;
  // 本文は resolver の値 > エラー本体の message
  const message = resolved.message ?? err.message;
  // レベルは resolver の値 > 既定マッピング
  const level = options.levelResolver?.(err) ?? mapped.level;
  // HttpError 由来の情報を meta にコピーするためのバッファ
  const baseMeta: Record<string, unknown> = {};

  // requestId が付いていれば相関ログ用に保持
  if (err.requestId !== undefined) {
    baseMeta.requestId = err.requestId;
  }
  // code は UI 側で再試行ボタン出し分け等に使うため保持
  if (err.code !== undefined) {
    baseMeta.code = err.code;
  }
  // status はデバッグや analytics 用に保持
  if (err.status !== undefined) {
    baseMeta.status = err.status;
  }
  // retryable は UI の挙動分岐に使うため保持
  if (err.retryable !== undefined) {
    baseMeta.retryable = err.retryable;
  }

  // baseMeta + 呼出側の追加 meta をマージ（後者が優先）
  const meta = {
    ...baseMeta,
    ...(options.meta ?? {}),
  };

  // 完成した ToastInput を返す（meta は空なら undefined にして余計なフィールドを残さない）
  return {
    level,
    title,
    message,
    duration: options.duration,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
    dedupeKey: options.dedupeKey,
  };
}
