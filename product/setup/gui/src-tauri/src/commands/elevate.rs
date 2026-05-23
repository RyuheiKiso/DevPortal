// このファイルはエクスプローラでログフォルダを開く Tauri コマンドを定義する
// shared::paths を使ってコンポーネントのログディレクトリを解決する

// shared クレートのパス解決関数をインポートする
use shared::paths;
// shared クレートのデフォルト設定をインポートする
use shared::config::SetupConfig;

// cmd_open_logs: エクスプローラでログフォルダを開く Tauri コマンド
// component: "verdaccio" または "backstage" を指定する文字列
#[tauri::command]
pub fn cmd_open_logs(
    // 対象コンポーネントの名前文字列
    component: String,
) -> Result<(), String> {
    // デフォルト設定を使用してログディレクトリパスを解決する
    let config = SetupConfig::default();

    // コンポーネント名に対応するログディレクトリを取得する
    let log_dir = match component.as_str() {
        // "verdaccio" の場合は Verdaccio のログディレクトリを返す
        "verdaccio" => paths::verdaccio_logs_dir(&config),
        // "backstage" の場合は Backstage のログディレクトリを返す
        "backstage" => paths::backstage_logs_dir(&config),
        // "baget" の場合は BaGet のログディレクトリを返す
        "baget" => paths::baget_logs_dir(&config),
        // "postgres" の場合は PostgreSQL のログディレクトリを返す
        "postgres" => paths::postgres_logs_dir(&config),
        // "sqlserver" の場合は SQL Server の ERRORLOG が格納される data_dir/Log を返す
        // （SQL Server は標準で data_dir/Log/ERRORLOG にログを書き出す）
        "sqlserver" => paths::sqlserver_data_dir(&config).join("Log"),
        // 未知のコンポーネント名の場合はエラーを返す
        other => return Err(format!("未知のコンポーネント: {}", other)),
    };

    // ログディレクトリが存在しない場合は作成を試みる
    if !log_dir.exists() {
        // ディレクトリを再帰的に作成する（失敗しても続行する）
        let _ = std::fs::create_dir_all(&log_dir);
    }

    // エクスプローラでログディレクトリを開く
    std::process::Command::new("explorer")
        // ログディレクトリのパスを引数として渡す
        .arg(&log_dir)
        // プロセスを非同期で起動する（完了を待たない）
        .spawn()
        // プロセス起動失敗をエラーメッセージに変換して返す
        .map_err(|e| format!("エクスプローラの起動に失敗しました: {}", e))?;

    // 正常終了を示す Ok(()) を返す
    Ok(())
}
