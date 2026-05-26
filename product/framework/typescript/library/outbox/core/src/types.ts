// エントリの送信ライフサイクル状態 (永続化される)
export type OutboxStatus =
  // 送信待ち (scheduler または publish で取得される対象)
  | "pending"
  // 送信中 (publish 呼び出し中、in-flight)
  | "publishing"
  // 送信完了 (sentAt 設定済み、index からは外す)
  | "sent"
  // 送信失敗で次回試行待ち (リトライ可能、attemptCount 進行中)
  | "failed"
  // 致命的失敗で DLQ 待避済み (手動 restoreFromDlq でのみ復活)
  | "dead";

// エントリ本体 (storage に永続化される immutable 値)
export interface OutboxEntry<T = unknown> {
  // 一意 ID (idFactory で採番)
  readonly id: string;
  // 現在の状態
  readonly status: OutboxStatus;
  // ユーザーが append で渡したペイロード本体 (publisher が解釈する)
  readonly payload: T;
  // 同一エントリの全試行で再利用される送信ベキ等キー (Idempotency-Key)
  readonly idempotencyKey: string;
  // 重複検出キー (同 key の pending/failed 既存エントリを上書きする)
  readonly dedupeKey?: string;
  // これまでの試行回数 (0 から始まる)
  readonly attemptCount: number;
  // 試行回数の上限 (作成時 retry.maxRetries+1 を保持、エントリ単位で固定)
  readonly maxAttempts: number;
  // 直近エラーの記録 (UI 表示や監査用)
  readonly lastError?: {
    // エラーメッセージ
    message: string;
    // 任意エラーコード (OutboxError.code 等)
    code?: string;
    // 記録時刻 (epoch ms)
    at: number;
  };
  // 作成時刻 (epoch ms)
  readonly createdAt: number;
  // 最終更新時刻 (epoch ms)
  readonly updatedAt: number;
  // 次回試行可能時刻 (epoch ms, backoff 経過後)
  // undefined の場合は「即時試行可能」を意味する (scheduler/flush の対象に含まれる)
  // 通常は append 直後・retry 直後に now() が、failed 後は now()+backoff が設定される
  readonly nextAttemptAt?: number;
  // 送信完了時刻 (status="sent" の場合のみ設定)
  readonly sentAt?: number;
  // publisher 用の宛先メタ (URL / topic / routing-key 等の任意情報)
  readonly target?: Readonly<Record<string, unknown>>;
  // 任意の付加情報 (requestId 等の相関情報)
  readonly meta?: Readonly<Record<string, unknown>>;
}

// 配信されるイベントの種別
export type OutboxEventType =
  // append または dedupe 置換で新規 / 更新追加された
  | "appended"
  // 送信中 (publishing 状態に遷移)
  | "publishing"
  // 送信成功 (sent 状態に遷移)
  | "published"
  // 送信失敗 (failed もしくは dead に遷移)
  | "failed"
  // DLQ へ移動された
  | "movedToDlq"
  // DLQ から復元された
  | "restored"
  // 削除された (remove API)
  | "removed"
  // scheduler の tick が走った (デバッグ用)
  | "scheduled"
  // scheduler 起動
  | "started"
  // scheduler 停止 / dispose 完了
  | "stopped";

// 1 件のイベント
export interface OutboxEvent<T = unknown> {
  // 種別
  readonly type: OutboxEventType;
  // 対象エントリ (started/stopped/scheduled 等では undefined)
  readonly entry?: OutboxEntry<T>;
  // エラー情報 (failed / movedToDlq 等で設定)
  readonly error?: {
    // エラーメッセージ
    message: string;
    // 任意エラーコード
    code?: string;
    // 原因例外そのもの (デバッグ・テレメトリ用、root cause を保持)
    // OutboxEntry.lastError には載せない (永続化を意識した最小情報のみ) が、
    // listener には完全な値を渡す
    cause?: unknown;
  };
}

// イベント購読リスナの型
export type OutboxListener<T = unknown> = (event: OutboxEvent<T>) => void;

// publisher 呼び出し時に渡される実行コンテキスト
export interface PublishContext {
  // 今回の試行番号 (0 始まり、attemptCount と一致)
  readonly attempt: number;
  // dispose / perAttemptTimeoutMs で abort される AbortSignal
  readonly signal: AbortSignal;
  // 同一エントリで一貫して使う Idempotency-Key
  readonly idempotencyKey: string;
  // 対象エントリの ID
  readonly entryId: string;
}

// 送信処理の抽象 (核となる拡張ポイント)
export type Publisher<T> = (
  // 送信対象エントリ
  entry: OutboxEntry<T>,
  // 実行コンテキスト
  ctx: PublishContext,
) => Promise<void>;

// リトライポリシ
export interface RetryPolicy {
  // 失敗時の最大リトライ回数 (既定 5; maxAttempts = maxRetries + 1)
  readonly maxRetries: number;
  // バックオフ基底 (既定 500ms)
  readonly backoffBaseMs: number;
  // バックオフ上限 (既定 60_000ms)
  readonly backoffMaxMs: number;
  // ジッタ戦略 ("full" / "none"、既定 "full")
  readonly jitter: "full" | "none";
  // 乱数源 (テスト用、既定 Math.random)
  readonly random?: () => number;
  // 失敗時の再試行判定をユーザーが上書きできる関数 (返り値 false で即 dead)
  readonly shouldRetry?: (err: unknown, attempt: number) => boolean;
}

// scheduler のオプション
export interface SchedulerOptions {
  // tick 間隔 (既定 5000ms)
  readonly intervalMs: number;
  // tick ごとに ± `interval * jitterRatio * random()` を加味 (0..1、既定 0.1)
  readonly jitterRatio: number;
  // 1 tick あたり処理する pending 最大件数 (既定 10)
  readonly batchSize: number;
  // インスタンス生成時に自動 start するか (既定 false)
  readonly autoStart: boolean;
}

// タイマー差し替え用 I/F (テスト用)
export interface OutboxTimer {
  // setTimeout 相当
  set(cb: () => void, ms: number): unknown;
  // clearTimeout 相当
  clear(handle: unknown): void;
}

// ロガー I/F (`@k1s0-ts-logger/core` の Logger インターフェースのサブセットに互換)
// 第二引数は構造化コンテキスト。logger/core 規約に従い `error` キーが入っていれば
// LogEntry.error に正規化されることが期待される (本ライブラリは慣習に従う)
export interface OutboxLogger {
  // デバッグログ
  debug(message: string, context?: Readonly<Record<string, unknown>>): void;
  // 情報ログ
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  // 警告ログ
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  // エラーログ
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

// 永続化アダプタ I/F
// withLock により同一エントリ id への操作は直列化される
export interface OutboxStorage<T = unknown> {
  // ID 指定でエントリを取得 (本体側)
  load(id: string): Promise<OutboxEntry<T> | undefined>;
  // エントリを保存 (index にも反映)
  save(entry: OutboxEntry<T>): Promise<void>;
  // エントリを完全削除 (index からも除去)
  remove(id: string): Promise<void>;
  // 一覧取得 (fromDlq=true なら DLQ 側を返す)
  list(fromDlq?: boolean): Promise<readonly OutboxEntry<T>[]>;
  // DLQ への移動 (id → dlq 側の領域へ)
  moveToDlq(id: string): Promise<void>;
  // DLQ からの復帰
  restoreFromDlq(id: string): Promise<void>;
  // 指定キーに対する操作を直列化する (read-modify-write の競合を防ぐ)
  withLock<R>(id: string, op: () => Promise<R>): Promise<R>;
}

// append 入力 (id / idempotencyKey / status 等は内部で補完)
export interface AppendInput<T> {
  // 送信したい本体ペイロード
  readonly payload: T;
  // 任意の Idempotency-Key (未指定なら idempotencyKeyFactory で自動採番)
  readonly idempotencyKey?: string;
  // 重複検出キー (既存 pending/failed をヒットさせて上書き)
  readonly dedupeKey?: string;
  // publisher が解釈する宛先メタ (URL / topic 等)
  readonly target?: Readonly<Record<string, unknown>>;
  // 任意の付加情報
  readonly meta?: Readonly<Record<string, unknown>>;
  // 個別 entry に対する試行回数上限 (未指定なら retry.maxRetries + 1)
  readonly maxAttempts?: number;
}

// list 取得時のフィルタ
export interface ListOptions {
  // 状態フィルタ (単一 or 配列)
  readonly status?: OutboxStatus | readonly OutboxStatus[];
  // 上限件数 (省略時は全件)
  readonly limit?: number;
  // DLQ 側を取得 (既定 false)
  readonly fromDlq?: boolean;
}

// マネージャ生成時の設定
export interface OutboxManagerConfig<T = unknown> {
  // 永続化アダプタ (必須)
  readonly storage: OutboxStorage<T>;
  // 送信処理 (必須)
  readonly publisher: Publisher<T>;
  // リトライポリシ (Partial、未指定値は既定値で埋める)
  readonly retry?: Partial<RetryPolicy>;
  // scheduler 設定 (Partial、未指定値は既定値で埋める)
  readonly scheduler?: Partial<SchedulerOptions>;
  // ID 採番関数 (テスト用、既定: createDefaultIdFactory)
  readonly idFactory?: () => string;
  // Idempotency-Key 採番関数 (未指定は idFactory を流用)
  readonly idempotencyKeyFactory?: () => string;
  // 時刻取得関数 (テスト用、既定 Date.now)
  readonly now?: () => number;
  // タイマー実装 (テスト用、既定: グローバル setTimeout/clearTimeout)
  readonly timer?: OutboxTimer;
  // ロガー (任意)
  readonly logger?: OutboxLogger;
  // DLQ 自動アーカイブ (上限超過時に最古を FIFO で削除)
  readonly dlqAutoArchive?: { maxEntries: number };
  // 1 試行あたりのタイムアウト (経過時に signal abort)
  readonly perAttemptTimeoutMs?: number;
}

// マネージャの公開インターフェース
export interface OutboxManager<T = unknown> {
  // エントリ追加 (Idempotency-Key 採番、dedupeKey 置換)
  append(input: AppendInput<T>): Promise<OutboxEntry<T>>;
  // 単一エントリの取得 (本体 / DLQ 両方を検索)
  get(id: string): Promise<OutboxEntry<T> | undefined>;
  // 一覧取得
  list(opts?: ListOptions): Promise<readonly OutboxEntry<T>[]>;
  // 即時送信 (publisher を呼び出し、状態遷移)
  publish(id: string): Promise<OutboxEntry<T>>;
  // failed / dead を pending にリセットして再送可能化
  retry(id: string): Promise<OutboxEntry<T>>;
  // エントリの完全削除
  remove(id: string): Promise<void>;
  // 手動 DLQ 移動
  moveToDlq(id: string, reason?: string): Promise<OutboxEntry<T>>;
  // 手動 DLQ 復帰
  restoreFromDlq(id: string): Promise<OutboxEntry<T>>;
  // 全 pending エントリを一巡だけ処理する (scheduler を待たず即時)
  flush(): Promise<void>;
  // 起動時のクラッシュリカバリ完了を待つ
  // autoStart=false で利用者が手動 publish/flush/start を呼ぶ場合、
  // recovery 完了より前に走らせると孤児エントリ (publishing 状態) が処理対象から外れる
  // ready() を await すれば recovery 完了が保証され、確実に最新状態で動作する
  ready(): Promise<void>;
  // イベント購読 (解除関数を返す)
  subscribe(listener: OutboxListener<T>): () => void;
  // scheduler 起動
  start(): void;
  // scheduler 停止
  stop(): void;
  // sent 状態の完了済みエントリを一括削除する
  // olderThanMs 指定時は sentAt が "now - olderThanMs" より古いものだけを対象にする
  // 戻り値は実際に削除した件数
  purgeCompleted(olderThanMs?: number): Promise<number>;
  // クリーンアップ (in-flight を abort、listener クリア、scheduler 停止)
  dispose(): Promise<void>;
}

// HTTP publisher が duck-typed で受ける HttpClient 風 I/F
export interface HttpClientLike {
  // 任意のリクエストを送信する (fetch ライク I/F)
  request(init: HttpRequestInitLike): Promise<HttpResponseLike>;
}

// HTTP publisher が利用するリクエスト init 型
export interface HttpRequestInitLike {
  // HTTP メソッド
  method?: string;
  // 完全 URL もしくはパス
  url: string;
  // ヘッダ
  headers?: Record<string, string>;
  // ボディ (JSON 想定)
  body?: unknown;
  // タイムアウトや AbortController と連動する signal
  signal?: AbortSignal;
}

// HTTP publisher が利用するレスポンス型
export interface HttpResponseLike {
  // HTTP ステータスコード
  status: number;
  // 成功フラグ (既定 ok 判定に使用)
  ok: boolean;
  // 任意のレスポンス本体
  body?: unknown;
}
