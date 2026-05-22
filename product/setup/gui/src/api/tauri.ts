// このファイルは Tauri invoke のラッパ関数群を提供する
// フロントエンドの各コンポーネントがバックエンドコマンドを呼び出す際に使用する

// Tauri v2 の invoke 関数と Channel クラスをインポートする
import { invoke, Channel } from '@tauri-apps/api/core';
// Tauri ダイアログプラグインのフォルダ選択関数をインポートする
import { open } from '@tauri-apps/plugin-dialog';

// 共通型定義をインポートする
import type {
  PrereqReport,
  ComponentStatus,
  SetupConfig,
  SetupEvent,
  InstalledPlugin,
  PluginCandidate,
  PluginInstallRequest,
  PluginRemoveRequest,
} from './types';

// prereqCheck: フロントエンドから前提条件チェックコマンドを呼び出す関数
// Rust 側の cmd_prereq_check を invoke して PrereqReport を返す
export async function prereqCheck(): Promise<PrereqReport> {
  // invoke で cmd_prereq_check コマンドを呼び出す
  return invoke<PrereqReport>('cmd_prereq_check');
}

// statusAll: 全コンポーネントのステータスを取得する関数
// Rust 側の cmd_status_all を invoke して ComponentStatus 配列を返す
export async function statusAll(): Promise<ComponentStatus[]> {
  // invoke で cmd_status_all コマンドを呼び出す
  return invoke<ComponentStatus[]>('cmd_status_all');
}

// installComponent: 指定コンポーネントのインストールを開始する関数
// Channel を作成して進捗イベントを onEvent コールバックにブリッジする
export async function installComponent(
  // インストール対象のコンポーネント名（"verdaccio" または "backstage"）
  component: string,
  // インストール設定オブジェクト
  config: SetupConfig,
  // 進捗イベントを受け取るコールバック関数
  onEvent: (ev: SetupEvent) => void,
): Promise<void> {
  // SetupEvent 型の Channel を作成する
  const channel = new Channel<SetupEvent>();
  // Channel にメッセージが届いたときに onEvent コールバックを呼び出す
  channel.onmessage = onEvent;
  // invoke で cmd_install コマンドを呼び出す
  return invoke<void>('cmd_install', {
    // コンポーネント名を渡す
    component,
    // インストール設定を渡す
    config,
    // 進捗イベントの送信先 Channel を渡す
    onEvent: channel,
  });
}

// uninstallComponent: 指定コンポーネントのアンインストールを開始する関数
// Channel を作成して進捗イベントを onEvent コールバックにブリッジする
export async function uninstallComponent(
  // アンインストール対象のコンポーネント名
  component: string,
  // データディレクトリを保持するかどうかのフラグ
  keepData: boolean,
  // 進捗イベントを受け取るコールバック関数
  onEvent: (ev: SetupEvent) => void,
  // アンインストール設定（install_root を含む）
  config: SetupConfig,
): Promise<void> {
  // SetupEvent 型の Channel を作成する
  const channel = new Channel<SetupEvent>();
  // Channel にメッセージが届いたときに onEvent コールバックを呼び出す
  channel.onmessage = onEvent;
  // invoke で cmd_uninstall コマンドを呼び出す
  return invoke<void>('cmd_uninstall', {
    // コンポーネント名を渡す
    component,
    // 呼び出し元から受け取った設定を渡す（install_root を含む）
    config,
    // データ保持フラグを渡す
    keepData,
    // 進捗イベントの送信先 Channel を渡す
    onEvent: channel,
  });
}

// loadConfig: setup.toml から現在の設定を読み込む関数
// ファイルが存在しない場合は Rust 側でデフォルト設定を返す
export async function loadConfig(): Promise<SetupConfig> {
  // invoke で cmd_load_config コマンドを呼び出す
  return invoke<SetupConfig>('cmd_load_config');
}

// saveConfig: 設定を setup.toml に保存する関数
// インストール実行前に install_root を永続化するために使用する
export async function saveConfig(config: SetupConfig): Promise<void> {
  // invoke で cmd_save_config コマンドを呼び出す
  return invoke<void>('cmd_save_config', { config });
}

// pickDirectory: ネイティブフォルダ選択ダイアログを開く関数
// キャンセルされた場合は null を返す
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  // open 関数でフォルダ選択ダイアログを開く
  const result = await open({
    // フォルダ選択モードを有効にする
    directory: true,
    // 複数選択は無効にする
    multiple: false,
    // デフォルトのパスを指定する（省略可能）
    defaultPath,
    // ダイアログのタイトルを設定する
    title: 'インストール先フォルダを選択',
  });
  // 文字列の場合はそのまま返し、それ以外（null / undefined）は null を返す
  return typeof result === 'string' ? result : null;
}

// serviceAction: サービスの start/stop/restart を実行する関数
// Rust 側の cmd_service_action を invoke する
export async function serviceAction(
  // 操作対象のコンポーネント名
  component: string,
  // 実行するアクション（"start" / "stop" / "restart"）
  action: string,
): Promise<void> {
  // invoke で cmd_service_action コマンドを呼び出す
  return invoke<void>('cmd_service_action', { component, action });
}

// openLogs: エクスプローラでログフォルダを開く関数
// Rust 側の cmd_open_logs を invoke する
export async function openLogs(
  // ログフォルダを開くコンポーネント名
  component: string,
): Promise<void> {
  // invoke で cmd_open_logs コマンドを呼び出す
  return invoke<void>('cmd_open_logs', { component });
}

// pluginList: インストール済みプラグイン一覧を取得する関数
// Rust 側の cmd_plugin_list を invoke して InstalledPlugin 配列を返す
export async function pluginList(): Promise<InstalledPlugin[]> {
  // invoke で cmd_plugin_list コマンドを呼び出す
  return invoke<InstalledPlugin[]>('cmd_plugin_list');
}

// pluginSearch: npm レジストリでプラグインを検索する関数
// query 文字列を受け取り、PluginCandidate 配列を返す
export async function pluginSearch(query: string): Promise<PluginCandidate[]> {
  // invoke で cmd_plugin_search コマンドを呼び出す
  return invoke<PluginCandidate[]>('cmd_plugin_search', { query });
}

// pluginInstall: プラグインをインストールし進捗イベントを受け取る関数
// Channel を作成して進捗イベントを onEvent コールバックにブリッジする
export async function pluginInstall(
  // インストール要求オブジェクト
  request: PluginInstallRequest,
  // 進捗イベントを受け取るコールバック関数
  onEvent: (ev: SetupEvent) => void,
): Promise<void> {
  // SetupEvent 型の Channel を作成する
  const channel = new Channel<SetupEvent>();
  // Channel にメッセージが届いたときに onEvent コールバックを呼び出す
  channel.onmessage = onEvent;
  // invoke で cmd_plugin_install コマンドを呼び出す
  return invoke<void>('cmd_plugin_install', { request, onEvent: channel });
}

// pluginRemove: プラグインを削除し進捗イベントを受け取る関数
// Channel を作成して進捗イベントを onEvent コールバックにブリッジする
export async function pluginRemove(
  // 削除要求オブジェクト
  request: PluginRemoveRequest,
  // 進捗イベントを受け取るコールバック関数
  onEvent: (ev: SetupEvent) => void,
): Promise<void> {
  // SetupEvent 型の Channel を作成する
  const channel = new Channel<SetupEvent>();
  // Channel にメッセージが届いたときに onEvent コールバックを呼び出す
  channel.onmessage = onEvent;
  // invoke で cmd_plugin_remove コマンドを呼び出す
  return invoke<void>('cmd_plugin_remove', { request, onEvent: channel });
}
