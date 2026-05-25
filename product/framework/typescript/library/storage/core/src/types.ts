// ストレージスコープの識別子
// secure: 機密度の高いデータ (認証トークン・PII 等、暗号化必須)
// durable: 永続化が必要なアプリケーション設定 (テーマ・言語等)
// session: タブ単位の一時状態 (ページ遷移で保持、タブ閉鎖で破棄)
// ephemeral: メモリのみ (リロードで消える、SSR/テスト用途)
export type StorageScope = "secure" | "durable" | "session" | "ephemeral";

// 統一非同期 KV ストア契約
// 同期バックエンド (localStorage 等) も createSyncBacked で Promise 化される
// T は格納する値の型 (string バックエンドは codec を被せて任意の T に変換可能)
export interface KvStore<T> {
  // 指定キーの値を取得する (未保存なら undefined)
  get(key: string): Promise<T | undefined>;
  // 指定キーへ値を保存する
  set(key: string, value: T): Promise<void>;
  // 指定キーの値を削除する (未保存キーへの remove は no-op)
  remove(key: string): Promise<void>;
  // 指定キーが保存済みかを判定する (任意実装)
  has?(key: string): Promise<boolean>;
  // 保存済みキーの一覧を返す (任意実装、列挙不可なアダプタは省略可)
  keys?(): Promise<readonly string[]>;
  // 全エントリを削除する (任意実装)
  clear?(): Promise<void>;
  // 変更を購読する (任意実装、withObservable で追加可能)
  // 通知引数: key, 新しい値 (削除時は undefined), 直前の値 (新規時は undefined)
  subscribe?(listener: (key: string, next: T | undefined, prev: T | undefined) => void): () => void;
}

// 単一キー (= 1 種の値) に対する型付きアクセサ
// auth の TokenStore のような「1 つのキーに 1 つの型」のユースケースに最適
export interface TypedSlot<T> {
  // 保存値を取得する (未保存なら undefined)
  get(): Promise<T | undefined>;
  // 値を保存する
  set(value: T): Promise<void>;
  // 値を削除する
  clear(): Promise<void>;
  // 値の変更を購読する (任意実装、内部 KvStore が subscribe をサポートする場合のみ)
  subscribe?(listener: (next: T | undefined) => void): () => void;
}

// 同期/非同期どちらでも受け入れる localStorage 互換の Storage 契約
// Web の Storage, React Native の AsyncStorage, テスト用 Map 等を統一して受ける
export interface SyncStorage {
  // 指定キーの文字列値を取得する (未保存は null)
  getItem(key: string): string | null | Promise<string | null>;
  // 指定キーへ文字列値を保存する
  setItem(key: string, value: string): void | Promise<void>;
  // 指定キーの値を削除する
  removeItem(key: string): void | Promise<void>;
  // インデックス指定でキー名を取得する (任意実装、Web Storage 互換)
  key?(index: number): string | null;
  // 保存件数 (任意実装、Web Storage 互換)
  readonly length?: number;
}

// マイグレーションステップの宣言
// fromVersion で保存されている値を toVersion 形へ変換する
// 同一スコープ内のマイグレーション群は (fromVersion, toVersion) が連続している必要がある
// (例: 0→1, 1→2, 2→3。中抜けや重複は MigrationError)
export interface Migration<TIn = unknown, TOut = unknown> {
  // 変換元のバージョン番号
  readonly fromVersion: number;
  // 変換先のバージョン番号 (= fromVersion + 1 が通常)
  readonly toVersion: number;
  // 変換関数 (同期/非同期どちらでも可)
  migrate(input: TIn): TOut | Promise<TOut>;
}

// 値のエンコード/デコード契約
// encode は in-memory の T を文字列に、decode は文字列を T に復元する
export interface Codec<T> {
  // T を直列化可能な文字列へ変換する
  encode(value: T): string;
  // 文字列から T を復元する (失敗時は throw)
  decode(raw: string): T;
}

// 監査イベントの単位
// withAudit が KvStore の各操作ごとに sink へ渡す
export interface AuditEvent {
  // 操作種別
  op: "get" | "set" | "remove" | "clear";
  // 対象キー (clear 時は null)
  key: string | null;
  // 成否 (例外を伴う失敗時は false)
  ok: boolean;
  // 失敗時の原因 (ok=false のみ意味あり)
  error?: unknown;
  // イベント発生時刻 (Date.now 相当のミリ秒)
  timestamp: number;
  // スコープ識別子 (registry 経由で wrap されたとき設定)
  scope?: StorageScope;
  // redact 適用後のサニタイズ済み payload (set 時のみ、redact が指定された場合のみ)
  payload?: unknown;
}

// 暗号化プロバイダ契約
// withEncryption は本契約を介してバイト列を暗号化/復号する
// IV (Initialization Vector) はプロバイダ内部で都度生成し、payload に含めて返す
// AAD (Additional Authenticated Data) は同じ平文を別のキー名で使った場合の改ざん検知に用いる
export interface CryptoProvider {
  // 平文 (Uint8Array) を暗号化する。aad 指定時は AAD としてバインドする
  encrypt(plaintext: Uint8Array, aad?: Uint8Array): Promise<{
    // 暗号文 (認証タグ込み、AES-GCM ならタグは末尾に内包)
    ciphertext: Uint8Array;
    // 暗号化に用いた IV (復号時に必要)
    iv: Uint8Array;
  }>;
  // 暗号文と IV を受けて平文を復号する。AAD は暗号化時と同じ値を渡す必要がある
  decrypt(
    payload: { ciphertext: Uint8Array; iv: Uint8Array },
    aad?: Uint8Array,
  ): Promise<Uint8Array>;
}

// clearScope / clearAll の挙動制御
export interface ClearScopeOptions {
  // 削除対象から除外するキー (配列なら完全一致、関数なら true を返したものを除外)
  exceptKeys?: readonly string[] | ((key: string) => boolean);
}

// 機密度別のストレージレジストリ
// secure: 機密 (認証トークン・PII、暗号化必須)
// durable: 永続 (設定・テーマ等)
// session: タブ単位の一時状態
// ephemeral: メモリのみ (リロードで消える)
export interface StorageRegistry {
  // 機密スコープの KvStore (登録時に注入)
  readonly secure: KvStore<unknown>;
  // 永続スコープの KvStore
  readonly durable: KvStore<unknown>;
  // セッションスコープの KvStore
  readonly session: KvStore<unknown>;
  // 揮発スコープの KvStore
  readonly ephemeral: KvStore<unknown>;
  // スコープ名から型付き KvStore を取り出す (T はアプリ側のキャスト前提)
  get<T = unknown>(scope: StorageScope): KvStore<T>;
  // 指定スコープを選択的にクリアする
  clearScope(scope: StorageScope, options?: ClearScopeOptions): Promise<void>;
  // 全スコープをクリアする
  clearAll(options?: ClearScopeOptions): Promise<void>;
}

// ストレージ系エラーの共通基底フィールド
// AppError 形 (kind / code / retryable) との変換に必要な情報を持つ
export interface StorageErrorLike {
  // エラー識別名 (type guard 用の固定値)
  readonly name: string;
  // 業務的なエラー区分 (例: "quota" / "not_available" / "migration")
  readonly kind: string;
  // 詳細コード (例: "STORAGE_QUOTA")
  readonly code: string;
  // 人間向けメッセージ
  readonly message: string;
  // 影響を受けたキー (任意)
  readonly key?: string;
  // 原因例外 (任意)
  readonly cause?: unknown;
  // リトライ可否 (true: 自動再試行余地あり)
  readonly retryable: boolean;
}

// ストレージ容量超過エラー
// QuotaExceededError / DOMException (code 22) を統一表現に変換した形
export interface QuotaError extends StorageErrorLike {
  // 識別名 (isQuotaError で判定する固定値)
  readonly name: "StorageQuotaError";
  // エラー区分 (固定値)
  readonly kind: "quota";
  // 詳細コード (固定値)
  readonly code: "STORAGE_QUOTA";
}

// ストレージ利用不可エラー
// プライベートモード / 機能未提供 / keys 未実装 等で操作不能な場合
export interface StorageNotAvailableError extends StorageErrorLike {
  // 識別名 (固定値)
  readonly name: "StorageNotAvailableError";
  // エラー区分 (固定値)
  readonly kind: "not_available";
  // 詳細コード (固定値)
  readonly code: "STORAGE_NOT_AVAILABLE";
}

// マイグレーション失敗エラー
// バージョン不連続 / migrate 関数の throw / fallback 未指定で reset 不可 等
export interface MigrationError extends StorageErrorLike {
  // 識別名 (固定値)
  readonly name: "StorageMigrationError";
  // エラー区分 (固定値)
  readonly kind: "migration";
  // 詳細コード (固定値)
  readonly code: "STORAGE_MIGRATION";
  // 失敗したステップの from バージョン (任意)
  readonly fromVersion?: number;
  // 失敗したステップの to バージョン (任意)
  readonly toVersion?: number;
}
