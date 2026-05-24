// このファイルは GUI のインストール画面で集約したセットアップログをファイルに保存する Tauri コマンドを定義する
// 失敗時の原因究明用に、画面上の全イベント（info / stdout / stderr / warn）を 1 ファイルへ書き出す

// ファイルへの書き込みに使用する Write トレイトをインポートする
use std::io::Write;
// パス操作に使用する PathBuf をインポートする
use std::path::PathBuf;
// タイムスタンプ生成に使用する SystemTime をインポートする
use std::time::{SystemTime, UNIX_EPOCH};

// shared クレートの設定構造体をインポートする
use shared::config::SetupConfig;
// shared クレートのパス解決関数をインポートする
use shared::paths;

// ログファイル名に許可する文字かどうかを判定する内部ヘルパー関数
// フロントから受け取った component 文字列をファイル名に埋め込む際のサニタイズに使用する
fn is_safe_filename_char(c: char) -> bool {
    // ASCII 英数字とハイフン・アンダースコアのみ許可する（パス区切りや特殊文字を排除する）
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

// component 文字列をファイル名安全な形に変換する内部ヘルパー関数
// 許可外文字はアンダースコアに置換し、空文字列の場合は "unknown" を返す
fn sanitize_component(component: &str) -> String {
    // 各文字をサニタイズして連結する
    let s: String = component
        // 文字単位に分解する
        .chars()
        // 安全な文字はそのまま、それ以外はアンダースコアに置換する
        .map(|c| if is_safe_filename_char(c) { c } else { '_' })
        // String に結合する
        .collect();
    // 空文字列のフォールバックを与える
    if s.is_empty() { "unknown".to_string() } else { s }
}

// コンポーネント名から対応するログディレクトリの絶対パスを解決する内部ヘルパー関数
// elevate.rs::cmd_open_logs と同じ方針で paths モジュールから各コンポーネントのログディレクトリを引き出す
fn resolve_log_dir(component: &str, config: &SetupConfig) -> PathBuf {
    // コンポーネント名に応じて適切なログディレクトリを選択する
    match component {
        // Verdaccio のログディレクトリを返す
        "verdaccio" => paths::verdaccio_logs_dir(config),
        // Backstage のログディレクトリを返す
        "backstage" => paths::backstage_logs_dir(config),
        // BaGet のログディレクトリを返す
        "baget" => paths::baget_logs_dir(config),
        // PostgreSQL のログディレクトリを返す
        "postgres" => paths::postgres_logs_dir(config),
        // SQL Server は ERRORLOG の格納場所に合わせて data_dir/Log を使う
        "sqlserver" => paths::sqlserver_data_dir(config).join("Log"),
        // 未知のコンポーネントは devportal_root/logs にフォールバックする
        _ => paths::devportal_root(config).join("logs"),
    }
}

// cmd_save_install_log: 集約済みのセットアップログをファイルとして保存する Tauri コマンド
// component: 保存先ディレクトリを決定するためのコンポーネント名（"backstage" など）
// content: 画面上で集約したログ本文（StepperState.allLogs の中身）
// 戻り値: 成功時は保存先ファイルの絶対パス文字列、失敗時はエラーメッセージ
#[tauri::command]
pub fn cmd_save_install_log(
    // コンポーネント名（保存先ディレクトリの決定に使用する）
    component: String,
    // 保存するログ本文（フロントが allLogs から組み立てた文字列）
    content: String,
) -> Result<String, String> {
    // setup.toml から設定を読み込む（カスタム install_root を反映するため）
    let config_path = paths::config_file();
    // 設定ファイルが存在する場合は読み込む、存在しない場合はデフォルト設定を使う
    let config = if config_path.exists() {
        // 設定ファイル読み込みに失敗してもデフォルトで継続する（保存処理の阻害を避ける）
        SetupConfig::from_file(&config_path).unwrap_or_default()
    } else {
        // 設定ファイルが存在しなければデフォルト設定で進める
        SetupConfig::default()
    };

    // コンポーネント名からログディレクトリの絶対パスを解決する
    let log_dir = resolve_log_dir(&component, &config);

    // ログディレクトリが存在しない場合は再帰的に作成する
    std::fs::create_dir_all(&log_dir)
        // ディレクトリ作成失敗をエラーメッセージに変換する
        .map_err(|e| format!("ログディレクトリの作成に失敗しました: {} ({})", log_dir.display(), e))?;

    // 現在時刻を UNIX エポック秒として取得する（依存追加を避けるため chrono を使わない）
    let epoch_secs = SystemTime::now()
        // UNIX_EPOCH からの経過時間を計算する
        .duration_since(UNIX_EPOCH)
        // 取得失敗時は 0 にフォールバックする（時計が UNIX_EPOCH より前の極端なケース）
        .map(|d| d.as_secs())
        // システムエラー時は 0 を返す
        .unwrap_or(0);

    // ファイル名を生成する（コンポーネント名はサニタイズ済みのものを使う）
    let safe_component = sanitize_component(&component);
    // install-<component>-<epoch>.log の形式で組み立てる
    let filename = format!("install-{}-{}.log", safe_component, epoch_secs);
    // 保存先パスを構築する
    let file_path = log_dir.join(&filename);

    // ファイルを作成して内容を書き込む
    let mut file = std::fs::File::create(&file_path)
        // ファイル作成失敗をエラーメッセージに変換する
        .map_err(|e| format!("ログファイル作成に失敗しました: {} ({})", file_path.display(), e))?;
    // バイト列に変換して一括書き込みする
    file.write_all(content.as_bytes())
        // 書き込み失敗をエラーメッセージに変換する
        .map_err(|e| format!("ログファイル書き込みに失敗しました: {} ({})", file_path.display(), e))?;

    // 保存先絶対パスを文字列で返す（GUI のトーストやリンク表示で使用する）
    Ok(file_path.to_string_lossy().to_string())
}
