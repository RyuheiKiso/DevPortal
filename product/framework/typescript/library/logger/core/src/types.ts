// ログレベル文字列リテラルの和集合（重要度順: trace < debug < info < warn < error < fatal）
export type LogLevel =
  // 最も詳細なトレースログ
  | "trace"
  // デバッグ向け詳細情報
  | "debug"
  // 通常の情報ログ
  | "info"
  // 警告
  | "warn"
  // エラー
  | "error"
  // 致命的エラー
  | "fatal";

// 実行環境の種別（dev / staging / prod）
export type Env = "dev" | "staging" | "prod";

// 環境ごとの最小ログレベル指定（指定しない env は defaultMinLevel にフォールバック）
export type EnvLogLevelMap = Partial<Record<Env, LogLevel>>;

// 1 件のログエントリ（イミュータブルに扱う前提）
export interface LogEntry {
  // 出力するログのレベル
  level: LogLevel;
  // 人間可読のメッセージ
  message: string;
  // エントリ発生時刻（epoch ms）
  timestamp: number;
  // 任意の分類タグ群
  tags?: readonly string[];
  // 構造化コンテキスト（リクエスト ID 等）
  context?: Readonly<Record<string, unknown>>;
  // 追加メタデータ（呼出側が data として渡したもの）
  meta?: Readonly<Record<string, unknown>>;
  // 例外オブジェクトの正規化形（Error から抽出）
  error?: { name: string; message: string; stack?: string };
}

// トランスポート（出力先）が満たすべき契約
export interface Transport {
  // 識別用の名称（onTransportError などで使用）
  readonly name: string;
  // 1 件のエントリを書き出す（同期 / 非同期どちらでも可）
  write(entry: LogEntry): void | Promise<void>;
  // 任意: バッファをフラッシュする
  flush?(): Promise<void>;
  // 任意: リソースを開放する
  dispose?(): Promise<void>;
}

// child() で派生 logger に渡すバインディング
export interface LoggerBindings {
  // 追加で付与するタグ
  tags?: readonly string[];
  // 追加で付与するコンテキスト
  context?: Readonly<Record<string, unknown>>;
}

// 各レベルメソッドへ渡せる追加データ（error フィールドは特別扱い）
export interface LogData {
  // 例外オブジェクト（Error または unknown）。指定時は entry.error に正規化される
  error?: unknown;
  // 上記以外の任意キーは meta に格納される
  [key: string]: unknown;
}

// Logger の公開インターフェース
export interface Logger {
  // 各ログレベルごとの発火メソッド
  trace(message: string, data?: LogData): void;
  debug(message: string, data?: LogData): void;
  info(message: string, data?: LogData): void;
  warn(message: string, data?: LogData): void;
  error(message: string, data?: LogData): void;
  fatal(message: string, data?: LogData): void;
  // 親バインディングを継承した派生 logger を返す
  child(bindings: LoggerBindings): Logger;
  // 全 transports の flush を実行（allSettled）
  flush(): Promise<void>;
  // 全 transports の dispose を実行（allSettled）
  dispose(): Promise<void>;
}

// 永続化系トランスポート用の抽象 KV ストア
// @k1s0-ts-storage/core の SyncStorage の別名 (構造的に同等、optional な key/length を許容)
// 既存のユーザー実装はそのまま受け入れられる (Structural Typing)
import type { SyncStorage } from "@k1s0-ts-storage/core";
export type StorageAdapter = SyncStorage;

// Logger 生成時の設定
export interface LoggerConfig {
  // 実行環境
  env: Env;
  // 環境別の最小ログレベル
  envLevels?: EnvLogLevelMap;
  // env が envLevels に無い場合のフォールバック最小レベル（既定: "info"）
  defaultMinLevel?: LogLevel;
  // 全エントリに付与するタグ
  tags?: readonly string[];
  // 全エントリに付与するコンテキスト
  context?: Readonly<Record<string, unknown>>;
  // 配信先トランスポート群（1 つ以上）
  transports: readonly Transport[];
  // 個別 transport の write/flush/dispose が throw した時の通知ハンドラ
  onTransportError?: (transport: Transport, entry: LogEntry | null, error: unknown) => void;
  // タイムスタンプ生成関数の差し替え（テスト用、既定: Date.now）
  now?: () => number;
}
