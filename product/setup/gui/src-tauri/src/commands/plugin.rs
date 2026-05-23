// このファイルはプラグイン管理に関する Tauri コマンドを定義する
// プラグイン一覧・検索・インストール・削除の 4 コマンドを提供する

// 標準ライブラリの mpsc チャネルをインポートする
use std::sync::mpsc;

// shared クレートのプラグイン管理型をインポートする
use shared::plugin::{InstalledPlugin, PluginInstallRequest, PluginRemoveRequest};
// shared クレートのレジストリ検索候補型をインポートする
use shared::registry::PluginCandidate;
// shared クレートの進捗イベント型をインポートする
use shared::event::{ActionKind, Component, Reporter, SetupEvent};
// shared クレートの設定構造体をインポートする
use shared::config::SetupConfig;
// shared クレートのパス解決関数をインポートする
use shared::paths::config_file;

// cmd_plugin_list: インストール済みプラグイン一覧を返す同期コマンド
// Backstage の package.json を解析して @backstage/plugin-* パターンの依存を返す
#[tauri::command]
pub fn cmd_plugin_list() -> Result<Vec<InstalledPlugin>, String> {
    // 設定ファイルのパスを解決する
    let config_path = config_file();
    // 設定ファイルが存在する場合は読み込み、存在しない場合はデフォルトを使用する
    let config = if config_path.exists() {
        // 設定ファイルから SetupConfig を読み込む（失敗した場合はデフォルトを使用する）
        SetupConfig::from_file(&config_path).unwrap_or_default()
    } else {
        // デフォルト設定を使用する
        SetupConfig::default()
    };
    // プラグイン一覧を取得して返す（エラーは String に変換する）
    shared::plugin::list(&config).map_err(|e| e.to_string())
}

// cmd_plugin_search: npm レジストリで Backstage プラグインを検索するコマンド
// query 文字列を受け取り、ureq で npm registry v1/search API を呼び出す
#[tauri::command]
pub async fn cmd_plugin_search(query: String) -> Result<Vec<PluginCandidate>, String> {
    // ブロッキング HTTP リクエストを spawn_blocking で非同期に実行する
    tauri::async_runtime::spawn_blocking(move || {
        // ureq の同期クライアントを使って npm レジストリを検索する
        shared::registry::search(&query).map_err(|e| e.to_string())
    })
    // spawn_blocking の JoinError を String に変換する
    .await
    .map_err(|e| e.to_string())?
}

// cmd_plugin_install: プラグインをインストールし進捗を Channel で送信するコマンド
// request: インストール対象のパッケージ名と種別
// on_event: Tauri v2 の Channel<SetupEvent>（進捗イベントの送信先）
#[tauri::command]
pub async fn cmd_plugin_install(
    // インストール要求（パッケージ名・種別を含む）
    request: PluginInstallRequest,
    // 進捗イベントの送信先 Channel
    on_event: tauri::ipc::Channel<SetupEvent>,
) -> Result<(), String> {
    // ブロッキング処理（mpsc 受信ループ）を専用スレッドで実行して非同期ランタイムを解放する
    tauri::async_runtime::spawn_blocking(move || {
        // 設定ファイルのパスを解決する
        let config_path = config_file();
        // 設定を読み込む（存在しない場合はデフォルト）
        let config = if config_path.exists() {
            SetupConfig::from_file(&config_path).unwrap_or_default()
        } else {
            SetupConfig::default()
        };

        // メインスレッドとワーカースレッド間でイベントを受け渡す mpsc チャネルを作成する
        let (tx, rx) = mpsc::channel::<SetupEvent>();
        // Reporter を作成する（送信端を渡してイベントを Reporter 経由で送信する）
        let reporter = Reporter::new(tx);
        // リクエストのクローンを作成してスレッドに移動する
        let request_clone = request.clone();
        // パッケージ名のクローンをエラー報告用に保持する
        let package_name = request.package_name.clone();

        // 別スレッドでプラグインインストールを実行する（JoinHandle を保持して panic を検知する）
        let handle = std::thread::spawn(move || {
            // プラグインのインストール処理を実行する
            if let Err(e) = shared::plugin::install(&config, &reporter, &request_clone) {
                // エンジンが reporter.failed() を呼ばずに Err を返した場合のフォールバック
                reporter.failed(
                    // Backstage コンポーネントとしてエラーを報告する
                    Component::Backstage,
                    // インストール操作であることを示す
                    ActionKind::Install,
                    // エラー内容を文字列で渡す
                    e.to_string(),
                    // 回復可能でないエラーとして通知する
                    false,
                );
            }
        });

        // 受信ループでイベントを Channel 経由でフロントエンドに送信する
        let mut failed = false;
        // recv() でチャネルからイベントを受信し、送信端が Drop されるまでループする
        for event in rx {
            // Failed イベントが来た場合はフラグを立てる
            if let SetupEvent::Failed { .. } = &event {
                // インストール失敗フラグをセットする
                failed = true;
            }
            // on_event.send() でフロントエンドの Channel にイベントを送信する
            let _ = on_event.send(event);
        }

        // スレッドの終了を待ち、panic が発生した場合は Err を返す
        // join() が Err を返すのはスレッドが panic した場合のみ
        if handle.join().is_err() {
            // panic 時は false success を避けるためエラーを返す
            return Err(format!(
                "プラグイン '{}' のインストール中に予期しないエラーが発生しました",
                package_name
            ));
        }

        // Failed イベントが来た場合はエラーを返す
        if failed {
            // プラグインインストールが失敗したことをフロントエンドに通知する
            Err(format!(
                "プラグイン '{}' のインストールに失敗しました",
                package_name
            ))
        } else {
            // インストールが正常に完了したことを示す Ok(()) を返す
            Ok(())
        }
    })
    // spawn_blocking の JoinError を String に変換する
    .await
    .map_err(|e| e.to_string())?
}

// cmd_plugin_remove: プラグインを削除し進捗を Channel で送信するコマンド
// request: 削除対象のパッケージ名と種別
// on_event: Tauri v2 の Channel<SetupEvent>（進捗イベントの送信先）
#[tauri::command]
pub async fn cmd_plugin_remove(
    // 削除要求（パッケージ名・種別を含む）
    request: PluginRemoveRequest,
    // 進捗イベントの送信先 Channel
    on_event: tauri::ipc::Channel<SetupEvent>,
) -> Result<(), String> {
    // ブロッキング処理を専用スレッドで実行する
    tauri::async_runtime::spawn_blocking(move || {
        // 設定ファイルのパスを解決する
        let config_path = config_file();
        // 設定を読み込む（存在しない場合はデフォルト）
        let config = if config_path.exists() {
            SetupConfig::from_file(&config_path).unwrap_or_default()
        } else {
            SetupConfig::default()
        };

        // メインスレッドとワーカースレッド間でイベントを受け渡す mpsc チャネルを作成する
        let (tx, rx) = mpsc::channel::<SetupEvent>();
        // Reporter を作成する
        let reporter = Reporter::new(tx);
        // リクエストのクローンを作成してスレッドに移動する
        let request_clone = request.clone();
        // パッケージ名のクローンをエラー報告用に保持する
        let package_name = request.package_name.clone();

        // 別スレッドでプラグイン削除を実行する（JoinHandle を保持して panic を検知する）
        let handle = std::thread::spawn(move || {
            // プラグインの削除処理を実行する
            if let Err(e) = shared::plugin::remove(&config, &reporter, &request_clone) {
                // エラー発生時は Failed イベントを送信する
                reporter.failed(
                    // Backstage コンポーネントとしてエラーを報告する
                    Component::Backstage,
                    // アンインストール操作であることを示す
                    ActionKind::Uninstall,
                    // エラー内容を文字列で渡す
                    e.to_string(),
                    // 回復可能でないエラーとして通知する
                    false,
                );
            }
        });

        // 受信ループでイベントを Channel 経由でフロントエンドに送信する
        let mut failed = false;
        // チャネルからイベントを受信してフロントエンドに転送する
        for event in rx {
            // Failed イベントが来た場合はフラグを立てる
            if let SetupEvent::Failed { .. } = &event {
                failed = true;
            }
            // フロントエンドにイベントを送信する
            let _ = on_event.send(event);
        }

        // スレッドの終了を待ち、panic が発生した場合は Err を返す
        if handle.join().is_err() {
            // panic 時は false success を避けるためエラーを返す
            return Err(format!(
                "プラグイン '{}' の削除中に予期しないエラーが発生しました",
                package_name
            ));
        }

        // 失敗フラグが立っている場合はエラーを返す
        if failed {
            Err(format!(
                "プラグイン '{}' の削除に失敗しました",
                package_name
            ))
        } else {
            // 正常完了を返す
            Ok(())
        }
    })
    // spawn_blocking の JoinError を String に変換する
    .await
    .map_err(|e| e.to_string())?
}
