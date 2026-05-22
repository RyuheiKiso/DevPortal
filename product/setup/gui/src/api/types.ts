// このファイルは Rust 側の構造体と対応する TypeScript 型定義を提供する
// フロントエンド全体で共通して使用する型をまとめて定義する

// Windows サービスの実行状態を表す文字列ユニオン型
export type ServiceStatus =
  | 'running'
  | 'stopped'
  | 'paused'
  | 'pending'
  | 'not_installed'
  | 'unknown';

// セットアップ対象コンポーネントの種別を表す文字列ユニオン型
export type ComponentKind = 'verdaccio' | 'backstage' | 'baget';

// ComponentStatus: 1 コンポーネントのステータス情報を表すインターフェース
// Rust 側の ComponentStatus 構造体と対応する
export interface ComponentStatus {
  // ステータスが属するコンポーネント種別
  component: ComponentKind;
  // Windows サービスの識別名
  service_name: string;
  // サービスの現在の実行状態
  service_status: ServiceStatus;
  // HTTP ヘルスチェックでエンドポイントに到達できるかどうか
  endpoint_reachable: boolean;
  // ヘルスチェック対象のエンドポイント URL
  endpoint_url: string;
  // データディレクトリが存在するかどうか
  data_dir_exists: boolean;
}

// PrereqItem: 1 つの前提コマンドのチェック結果を表すインターフェース
// Rust 側の PrereqItem 構造体と対応する
export interface PrereqItem {
  // チェック対象コマンドの名前（例: "node"）
  name: string;
  // コマンドが PATH 経由で実行可能かどうか
  found: boolean;
  // コマンドが見つかった場合の実行ファイルパス文字列
  path: string | null;
  // コマンドのバージョン文字列
  version: string | null;
  // コマンドが見つからなかった場合にユーザーに表示するインストール案内文
  install_hint: string;
}

// PrereqReport: 全コマンドのチェック結果をまとめたインターフェース
// Rust 側の PrereqReport 構造体と対応する
export interface PrereqReport {
  // 各コマンドのチェック結果リスト
  items: PrereqItem[];
  // 全コマンドが見つかった場合に true
  all_ok: boolean;
}

// VerdaccioConfig: Verdaccio 固有の設定インターフェース
// Rust 側の VerdaccioConfig 構造体と対応する
export interface VerdaccioConfig {
  // Verdaccio が待ち受けるポート番号
  port: number;
  // インストールする Verdaccio のバージョン指定文字列
  version: string;
  // アンインストール時にデータを保持するかどうか
  keep_data_on_uninstall: boolean;
}

// BackstageConfig: Backstage 固有の設定インターフェース
// Rust 側の BackstageConfig 構造体と対応する
export interface BackstageConfig {
  // create-app の --path オプションに渡すアプリ名
  app_name: string;
  // Backstage フロントエンドが待ち受けるポート番号
  frontend_port: number;
  // Backstage バックエンドが待ち受けるポート番号
  backend_port: number;
  // アンインストール時にデータを保持するかどうか
  keep_data_on_uninstall: boolean;
  // 起動モード（dev または build）
  mode: 'dev' | 'build';
}

// BaGetConfig: BaGet 固有の設定インターフェース
// Rust 側の BaGetConfig 構造体と対応する
export interface BaGetConfig {
  // BaGet が待ち受けるポート番号
  port: number;
  // インストールする BaGet のバージョン指定文字列
  version: string;
  // アンインストール時にデータを保持するかどうか
  keep_data_on_uninstall: boolean;
}

// SetupConfig: セットアップ全体の設定をまとめたインターフェース
// Rust 側の SetupConfig 構造体と対応する
export interface SetupConfig {
  // Windows サービス名のプレフィックス
  service_prefix: string;
  // インストール先ルートディレクトリ（null のとき %ProgramData%\DevPortal を使う）
  install_root: string | null;
  // Verdaccio 固有の設定
  verdaccio: VerdaccioConfig;
  // Backstage 固有の設定
  backstage: BackstageConfig;
  // BaGet 固有の設定
  baget: BaGetConfig;
}

// PluginKind: プラグインの適用対象種別を表す文字列ユニオン型
// Rust 側の PluginKind 列挙型と対応する（serde snake_case）
export type PluginKind = 'frontend' | 'backend';

// InstalledPlugin: インストール済みプラグインの情報を表すインターフェース
// Rust 側の InstalledPlugin 構造体と対応する
export interface InstalledPlugin {
  // npm パッケージ名（例: @backstage/plugin-kubernetes）
  name: string;
  // インストールされているバージョン文字列
  version: string;
  // プラグインの適用対象種別
  kind: PluginKind;
}

// PluginCandidate: npm レジストリから取得したプラグイン候補を表すインターフェース
// Rust 側の PluginCandidate 構造体と対応する
export interface PluginCandidate {
  // npm パッケージ名
  name: string;
  // 最新バージョン文字列
  version: string;
  // パッケージの説明文
  description: string;
  // プラグインの適用対象種別
  kind: PluginKind;
  // リポジトリ URL（取得できない場合は null）
  repository_url: string | null;
}

// PluginInstallRequest: プラグインインストール要求を表すインターフェース
// Rust 側の PluginInstallRequest 構造体と対応する
export interface PluginInstallRequest {
  // インストールする npm パッケージ名
  package_name: string;
  // プラグインの適用対象種別
  kind: PluginKind;
}

// PluginRemoveRequest: プラグイン削除要求を表すインターフェース
// Rust 側の PluginRemoveRequest 構造体と対応する
export interface PluginRemoveRequest {
  // 削除する npm パッケージ名
  package_name: string;
  // プラグインの適用対象種別
  kind: PluginKind;
}

// SetupEvent: CLI/GUI 共通の進捗イベントを表す判別ユニオン型
// Rust 側の SetupEvent 列挙型と対応する（tag = "kind" の内部タグ方式）
export type SetupEvent =
  // セットアップのステップ開始を通知するイベント
  | { kind: 'step_start'; id: string; label: string; total_steps: number; index: number }
  // セットアップのステップ完了を通知するイベント
  | { kind: 'step_done'; id: string; duration_ms: number }
  // ステップの進捗率を通知するイベント
  | { kind: 'progress'; id: string; percent: number; message: string | null }
  // 外部コマンドの標準出力の 1 行を通知するイベント
  | { kind: 'stdout'; id: string; line: string }
  // 外部コマンドの標準エラー出力の 1 行を通知するイベント
  | { kind: 'stderr'; id: string; line: string }
  // 警告メッセージを通知するイベント
  | { kind: 'warn'; id: string | null; message: string }
  // 情報メッセージを通知するイベント
  | { kind: 'info'; message: string }
  // セットアップ操作の正常完了を通知するイベント
  | { kind: 'finished'; component: ComponentKind; action: string; summary: string }
  // セットアップ操作の失敗を通知するイベント
  | { kind: 'failed'; component: ComponentKind; action: string; error: string; recoverable: boolean };
