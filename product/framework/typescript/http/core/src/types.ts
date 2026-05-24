// 最小 Logger 契約（@k1s0-ts-logger/core の Logger と構造的にサブセット互換）
// dependency を持たないため、利用者は構造一致するオブジェクトを自由に注入できる
export interface Logger {
  // デバッグ用の詳細ログ（http.request など）
  debug(message: string, context?: unknown): void;
  // 通常情報ログ（http.response 成功時）
  info(message: string, context?: unknown): void;
  // 警告ログ（!ok レスポンスの記録）
  warn(message: string, context?: unknown): void;
  // エラーログ（throw 化された失敗）
  error(message: string, context?: unknown): void;
}

// 対応する HTTP メソッド（一般的な 7 種）
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

// 内部で組み立て済みの 1 リクエスト表現（interceptor に渡る型）
export interface HttpRequest {
  // 絶対 URL（baseUrl + path + query が組み立て済み）
  url: string;
  // メソッド（既定は GET）
  method: HttpMethod;
  // ヘッダ（X-Request-Id と auth ヘッダはここで合成済み）
  headers: Record<string, string>;
  // リクエストボディ（fetch の BodyInit 互換 / 任意）
  body?: BodyInit | null;
  // 親 AbortSignal（タイムアウト合成前のユーザ signal）
  signal?: AbortSignal;
  // 相関 ID（X-Request-Id ヘッダ値と同一）
  requestId: string;
  // interceptor 間で受け渡すための補助情報（型安全な拡張ポイント）
  meta?: Readonly<Record<string, unknown>>;
}

// 1 レスポンス表現
export interface HttpResponse<T = unknown> {
  // HTTP ステータスコード
  status: number;
  // 2xx 判定（fetch の Response.ok と同義）
  ok: boolean;
  // 平坦化されたレスポンスヘッダ（小文字キーで返す、重複ヘッダは最後の値のみ）
  headers: Record<string, string>;
  // 原本の Headers オブジェクト（Set-Cookie 等の multi-value 取得用、B-1）
  // 例: res.rawHeaders.getSetCookie() で全 Set-Cookie 値の配列を取得
  rawHeaders: Headers;
  // 利用側で型付け可能なボディ（低レベル client では undefined、rest ヘルパで JSON parse 済み）
  body: T;
  // 原本 Response（streaming / バイナリ等のため保持）
  raw: Response;
  // 対応するリクエスト（requestId 参照用）
  request: HttpRequest;
}

// リトライポリシー定義
export interface RetryPolicy {
  // 最大リトライ回数（既定 3）
  maxRetries: number;
  // 指数バックオフの基底待機時間 ms（既定 200）
  backoffBaseMs: number;
  // バックオフの上限 ms（既定 10_000）
  backoffMaxMs?: number;
  // ジッタ戦略（"full" は 0〜expBackoff のランダム、"none" は決定的）
  jitter?: "full" | "none";
  // 既定リトライ対象ステータス（既定 [408, 429, 500, 502, 503, 504]、425 は除外）
  retryableStatuses?: readonly number[];
  // 任意判定関数（指定時は retryableStatuses を上書き、ただし冪等性ガードは別途適用される）
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  // 乱数源（テストで決定論化するために注入可能）
  random?: () => number;
  // 非冪等メソッド（POST/PATCH 等）でも既定リトライを許可する明示オプトイン（既定 false、C-A2）
  // true にすると IDEMPOTENT_METHODS / Idempotency-Key ガードがスキップされる
  allowNonIdempotent?: boolean;
}

// タイムアウトポリシー（リクエスト全体 / 1 試行ごと）
export interface TimeoutPolicy {
  // リクエスト全体（リトライ含む）の上限 ms
  totalMs?: number;
  // 1 試行ごとの上限 ms
  perAttemptMs?: number;
}

// 認証ヘッダ供給契約（毎リクエストごとに呼ばれる）
export interface AuthProvider {
  // 適用するヘッダ群を返す（Promise 可、token 更新の async に対応）
  getAuthHeaders(): Promise<Record<string, string>>;
}

// リクエスト ID 生成関数の型
export type RequestIdGenerator = () => string;

// request interceptor 契約（HttpRequest を変換して返す）
export interface RequestInterceptor {
  // 同期/非同期どちらでも OK
  (req: HttpRequest): HttpRequest | Promise<HttpRequest>;
}

// response interceptor 契約（HttpResponse を変換して返す）
export interface ResponseInterceptor {
  // 同期/非同期どちらでも OK
  (res: HttpResponse): HttpResponse | Promise<HttpResponse>;
}

// error interceptor 契約（必ず throw する責務、swallow 不可）
export interface ErrorInterceptor {
  // 必ず例外を再 throw すること
  (err: unknown, req: HttpRequest): never | Promise<never>;
}

// クライアント全体の構成
export interface HttpClientConfig {
  // ベース URL（path 連結時に使用、絶対 URL を渡せば素通し）
  baseUrl?: string;
  // すべてのリクエストに付与する既定ヘッダ
  defaultHeaders?: Record<string, string>;
  // 認証ヘッダ供給（任意）
  auth?: AuthProvider;
  // リトライポリシー部分指定（既定値とマージ）
  retry?: Partial<RetryPolicy>;
  // タイムアウトポリシー
  timeout?: TimeoutPolicy;
  // 構造一致する Logger（任意、無指定なら noopLogger）
  logger?: Logger;
  // 相関 ID を載せるヘッダ名（任意、無指定なら "X-Request-Id"、traceparent も可能、B-2）
  requestIdHeader?: string;
  // 相関 ID 生成関数（任意、無指定なら crypto.randomUUID フォールバック、traceparent を使うなら createTraceparent を渡す）
  generateRequestId?: RequestIdGenerator;
  // 実 fetch 実装（任意、テスト/環境差替用）
  fetchImpl?: typeof fetch;
  // request interceptor 群（順次適用）
  requestInterceptors?: readonly RequestInterceptor[];
  // response interceptor 群（順次適用）
  responseInterceptors?: readonly ResponseInterceptor[];
  // error interceptor 群（必ず throw、順次適用）
  errorInterceptors?: readonly ErrorInterceptor[];
}

// 個別リクエストの初期化情報
export interface HttpRequestInit {
  // 相対 path または絶対 URL
  url: string;
  // メソッド（既定 GET）
  method?: HttpMethod;
  // 任意ヘッダ（defaultHeaders とマージ）
  headers?: Record<string, string>;
  // リクエストボディ
  body?: BodyInit | null;
  // ユーザ提供の AbortSignal
  signal?: AbortSignal;
  // URL クエリ（オブジェクトで指定、自動エンコード）
  query?: Record<
    string,
    string | number | boolean | null | undefined | readonly string[]
  >;
  // interceptor に渡す補助情報（コピーされて HttpRequest.meta に格納）
  meta?: Readonly<Record<string, unknown>>;
}

// HTTP クライアントインターフェース
export interface HttpClient {
  // 任意リクエストを実行
  request<T = unknown>(init: HttpRequestInit): Promise<HttpResponse<T>>;
  // 部分的設定上書きで派生クライアントを作成（baseUrl / headers などスコープ局所化）
  withConfig(override: Partial<HttpClientConfig>): HttpClient;
  // 現在の設定スナップショット（読み取り専用）
  readonly config: Readonly<HttpClientConfig>;
}
