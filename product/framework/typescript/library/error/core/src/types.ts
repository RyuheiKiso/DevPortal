// AppError の分類値（HTTP / 業務 / 通信 / システムなど）を網羅的に列挙
// この配列を単一の source of truth として、schema と guards の両方で再利用する
export const appErrorKindValues = [
  // 通信失敗（DNS 解決失敗 / コネクション拒否など）
  "network",
  // タイムアウト（リクエスト送信〜応答受信が時間内に完了しない）
  "timeout",
  // HTTP 一般エラー（より細かい分類が当てはまらない場合の汎用箱）
  "http",
  // 認証エラー（未ログイン / トークン失効）
  "auth",
  // 認可エラー（認証は成功しているが権限が不足）
  "permission",
  // 入力検証エラー（バリデーション失敗）
  "validation",
  // 業務ルール起因のエラー（残高不足など）
  "business",
  // 同時更新による競合（楽観ロック / バージョン衝突）
  "conflict",
  // リソース未検出
  "notFound",
  // 予期しないサーバーエラーや内部例外
  "system",
  // 分類不能なエラー（unknown が来たら必ず再分類を検討）
  "unknown",
] as const;

// 上記配列から union 型を導出（追加・削除すれば型と値が常に同期する）
export type AppErrorKind = (typeof appErrorKindValues)[number];

// 重要度の値配列（schema と guards から再利用）
export const appErrorSeverityValues = [
  // 情報レベル（通知のみで業務影響なし）
  "info",
  // 警告レベル（業務継続可能だが注視）
  "warning",
  // エラーレベル（業務影響あり、対処を要する）
  "error",
  // 致命レベル（再起動・運用対応を要する）
  "critical",
] as const;

// 上記配列から union 型を導出
export type AppErrorSeverity = (typeof appErrorSeverityValues)[number];

// エラー発生時の付随コンテキスト（ログ・トレース・タグ）
export interface ErrorContext {
  // 実行中の業務操作名（例: "customer.save"）
  operation?: string;
  // UI 上の発生コンポーネント名
  component?: string;
  // リクエスト追跡 ID（HTTP ヘッダ x-request-id 等）
  requestId?: string;
  // 分散トレース ID（W3C traceparent 等）
  traceId?: string;
  // 検索用タグ（自由形式の文字列群）
  tags?: readonly string[];
  // 追加メタデータ（PII を含めないこと）
  metadata?: Record<string, unknown>;
}

// 1 件の入力検証エラー
export interface ValidationIssue {
  // フィールドパス（例: ["customer", "name"]）
  path?: readonly (string | number)[];
  // エラーコード（例: "too_small"）
  code?: string;
  // ユーザー向けメッセージ
  message: string;
}

// AppError を生成するときの入力（必要なフィールドのみ渡せば既定値が補完される）
export interface AppErrorInput {
  // エラー分類（必須）
  kind: AppErrorKind;
  // 内部メッセージ（ログ向け、未指定なら userMessage で代用）
  message?: string;
  // ユーザー向けメッセージ（未指定なら kind 既定文言）
  userMessage?: string;
  // 詳細コード（例: "VERSION_CONFLICT"）
  code?: string;
  // HTTP ステータスコード
  status?: number;
  // リクエスト追跡 ID
  requestId?: string;
  // 分散トレース ID
  traceId?: string;
  // 任意の詳細情報（レスポンス body など）
  details?: unknown;
  // 原因例外（Error 推奨、循環参照になる値は避ける）
  cause?: unknown;
  // リトライ可能か（未指定なら kind + status から既定値）
  retryable?: boolean;
  // 監視通報対象か（未指定なら kind から既定値）
  reportable?: boolean;
  // 重要度（未指定なら kind から既定値）
  severity?: AppErrorSeverity;
  // 検証エラーの内訳
  validationIssues?: readonly ValidationIssue[];
  // 付随コンテキスト
  context?: ErrorContext;
}

// 正規化済みアプリケーションエラー（plain object として扱う）
// Error クラスを継承しないのは、JSON シリアライズ・構造化ログとの相性を優先するため
export interface AppError {
  // 名前は常に "AppError" 固定（type guard で識別子として利用）
  name: "AppError";
  // エラー分類
  kind: AppErrorKind;
  // 内部メッセージ（ログ向け）
  message: string;
  // ユーザー向けメッセージ
  userMessage: string;
  // 詳細コード
  code?: string;
  // HTTP ステータスコード
  status?: number;
  // リクエスト追跡 ID
  requestId?: string;
  // 分散トレース ID
  traceId?: string;
  // 任意の詳細情報
  details?: unknown;
  // 原因例外
  cause?: unknown;
  // リトライ可能か
  retryable: boolean;
  // 監視通報対象か
  reportable: boolean;
  // 重要度
  severity: AppErrorSeverity;
  // 検証エラーの内訳
  validationIssues?: readonly ValidationIssue[];
  // 付随コンテキスト
  context?: ErrorContext;
}

// AppError をシリアライズした形（cause を含めない安全な構造）
// JSON 化や transport 経由送信時にこちらを利用する
// name は AppError と区別するため "SerializedAppError" 固定（isAppError が serialized を誤判定する問題を防ぐ）
export interface SerializedAppError {
  // 名前は常に "SerializedAppError" 固定（AppError との区別キーとして利用）
  name: "SerializedAppError";
  // エラー分類
  kind: AppErrorKind;
  // 内部メッセージ
  message: string;
  // ユーザー向けメッセージ
  userMessage: string;
  // 詳細コード
  code?: string;
  // HTTP ステータスコード
  status?: number;
  // リクエスト追跡 ID
  requestId?: string;
  // 分散トレース ID
  traceId?: string;
  // 任意の詳細情報
  details?: unknown;
  // リトライ可能か
  retryable: boolean;
  // 監視通報対象か
  reportable: boolean;
  // 重要度
  severity: AppErrorSeverity;
  // 検証エラーの内訳
  validationIssues?: readonly ValidationIssue[];
  // 付随コンテキスト
  context?: ErrorContext;
}

// normalizeError の任意オプション（ErrorContext を継承して呼び出し簡略化）
export interface NormalizeOptions extends ErrorContext {
  // 分類不能時の既定 kind（指定しなければ "unknown"）
  defaultKind?: AppErrorKind;
  // ユーザーメッセージの上書き既定値
  defaultUserMessage?: string;
  // cause を保持するか（false で破棄し、循環参照を避けられる）
  includeCause?: boolean;
  // 既存 AppError 入力時の context マージ戦略
  // - "shallowMerge"（既定）: options 由来 context を下敷きに、既存 AppError 側の値が勝つ shallow merge
  // - "preserveExisting": 既存 AppError 側に context があれば options 由来 context を採用しない（旧挙動）
  contextStrategy?: "preserveExisting" | "shallowMerge";
}

// HTTP クライアントが投げる典型的なエラー形状（ライブラリ非依存の duck type）
export interface HttpErrorLike {
  // 多くのクライアントが付ける名前フィールド
  name?: string;
  // メッセージ
  message?: string;
  // HTTP ステータスコード（fetch 系）
  status?: number;
  // HTTP ステータスコード（axios 系）
  statusCode?: number;
  // 詳細コード
  code?: string;
  // リクエスト追跡 ID
  requestId?: string;
  // 分散トレース ID
  traceId?: string;
  // レスポンスオブジェクト（ライブラリにより構造が異なるため複数形を許容）
  response?: {
    // レスポンス側 status
    status?: number;
    // レスポンスヘッダ（Web Headers / plain object どちらも許容）
    headers?: Headers | Record<string, string | undefined>;
    // レスポンス body（fetch 系）
    body?: unknown;
    // レスポンス body（axios 系）
    data?: unknown;
  };
  // 詳細情報
  details?: unknown;
  // 原因例外
  cause?: unknown;
}

// 構造化ログ向けのレコード（cause を含めず safe）
export interface LogRecord {
  // 名前は固定値（ログ検索キー）
  errorName: "AppError";
  // エラー分類
  kind: AppErrorKind;
  // 重要度
  severity: AppErrorSeverity;
  // 内部メッセージ
  message: string;
  // ユーザー向けメッセージ
  userMessage: string;
  // 詳細コード
  code?: string;
  // HTTP ステータスコード
  status?: number;
  // リクエスト追跡 ID
  requestId?: string;
  // 分散トレース ID
  traceId?: string;
  // リトライ可能か
  retryable: boolean;
  // 監視通報対象か
  reportable: boolean;
  // 任意の詳細情報
  details?: unknown;
  // 検証エラーの内訳
  validationIssues?: readonly ValidationIssue[];
  // 付随コンテキスト
  context?: ErrorContext;
}

// 通知の重要度（AppError の severity から派生）
export type NotificationLevel = "info" | "warning" | "error";

// 通知アダプタへ渡す入力（toast 形式のみを想定）
export interface NotificationInput {
  // 通知種別（現状 toast のみ）
  kind: "toast";
  // 重要度
  level: NotificationLevel;
  // タイトル文字列
  title: string;
  // 本文メッセージ
  message: string;
  // 重複抑制キー（同一キーは短時間に 1 回のみ表示する想定）
  dedupeKey?: string;
}
