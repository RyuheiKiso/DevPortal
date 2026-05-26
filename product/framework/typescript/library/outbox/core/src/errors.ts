// OutboxError が表現するエラーコード (アプリ層で switch しやすいよう union 化)
export type OutboxErrorCode =
  // 指定 ID のエントリが存在しない
  | "OUTBOX_NOT_FOUND"
  // storage への永続化操作が失敗した
  | "OUTBOX_PERSISTENCE_FAILED"
  // publisher 呼び出しが失敗した (retryable か否かは retryable フラグで区別)
  | "OUTBOX_PUBLISH_FAILED"
  // dispose 後の操作が実行された (冪等性違反)
  | "OUTBOX_DISPOSED"
  // 想定外の状態遷移が要求された (例: sent エントリを retry など)
  | "OUTBOX_INVALID_STATE";

// OutboxError のコンストラクタ引数
export interface OutboxErrorInit {
  // エラー種別
  code: OutboxErrorCode;
  // ユーザー向けメッセージ
  message: string;
  // 再試行可能か (publisher エラーで使用、既定 true)
  retryable?: boolean;
  // 対象エントリ ID (該当する場合)
  entryId?: string;
  // 原因例外 (任意)
  cause?: unknown;
}

// Outbox 固有のエラー型
// publisher やストレージ層の例外を統一的に表現する
export class OutboxError extends Error {
  // エラー種別 (switch 用)
  readonly code: OutboxErrorCode;
  // 再試行可能か (false の場合は即 dead 化対象)
  readonly retryable: boolean;
  // 対象エントリ ID (該当する場合)
  readonly entryId?: string;
  // 原因例外 (Error.prototype.cause として標準互換、ES2022 対応)
  declare readonly cause?: unknown;

  // コンストラクタ
  constructor(init: OutboxErrorInit) {
    // ES2022 標準準拠で cause を super に渡す (Error.prototype.cause が自動で設定される)
    // cause 未指定なら ErrorOptions 自体を省略してエンジン側のデフォルト挙動に従う
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    // instanceof 判定用に name を固定
    this.name = "OutboxError";
    // コードを保持
    this.code = init.code;
    // retryable は未指定なら true (リトライ可)
    this.retryable = init.retryable ?? true;
    // 任意の対象 ID
    this.entryId = init.entryId;
  }
}

// 任意の値が OutboxError かを判定する型ガード
export function isOutboxError(value: unknown): value is OutboxError {
  // instanceof で name と code を併せて確認 (cross-realm でも安全)
  return (
    value instanceof Error &&
    (value as { name?: string }).name === "OutboxError" &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

// 任意の例外を Error に正規化する
// - Error インスタンスなら原型を保持
// - 文字列 / オブジェクトは新しい Error にラップして message を埋める
export function normalizeError(value: unknown): Error {
  // 既に Error なら何もせず返す
  if (value instanceof Error) {
    return value;
  }
  // 文字列ならそのまま message に使う
  if (typeof value === "string") {
    return new Error(value);
  }
  // それ以外 (オブジェクト・undefined・null・数値等) は JSON で文字列化を試みる
  try {
    // JSON 化できる値はその文字列を message に
    return new Error(JSON.stringify(value));
  } catch {
    // 循環参照などで失敗する場合は固定メッセージ
    return new Error("unknown error");
  }
}

// OutboxEntry.lastError 用の構造化エラーへ変換する
export function toEntryError(err: unknown, at: number): {
  // メッセージ本体
  message: string;
  // 任意コード
  code?: string;
  // 発生時刻
  at: number;
} {
  // OutboxError ならコード付き表現
  if (isOutboxError(err)) {
    return { message: err.message, code: err.code, at };
  }
  // 通常の Error は message だけ拾う
  const normalized = normalizeError(err);
  // code は省略
  return { message: normalized.message, at };
}
