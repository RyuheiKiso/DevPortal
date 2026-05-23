// このファイルはサービスの start/stop/restart を制御する Tauri コマンドを定義する
// NSSM を使って Windows サービスの操作を行う（SQL Server のみ sc.exe を直接使用する）

// 外部コマンド実行（sc.exe）に必要な型をインポートする
use std::process::Command;

// shared クレートの NSSM ラッパをインポートする
use shared::nssm::Nssm;
// shared クレートのデフォルト設定をインポートする
use shared::config::SetupConfig;
// shared クレートのパスユーティリティをインポートする（設定ファイルパス取得に使用）
use shared::paths;
// shared クレートのエンジンファクトリ関数をインポートする
use shared::engine::engine_for;
// shared クレートのコンポーネント種別をインポートする
use shared::event::Component;

// cmd_service_action: サービスの start/stop/restart を制御する Tauri コマンド
// component: "verdaccio" / "backstage" / "baget" を指定する文字列
// action: "start" / "stop" / "restart" のいずれかを指定する文字列
// 注: 管理者権限は app.manifest の requireAdministrator で OS レベルで保証される
#[tauri::command]
pub fn cmd_service_action(
    // 操作対象のコンポーネント名文字列
    component: String,
    // 実行するサービス操作の種別文字列
    action: String,
) -> Result<(), String> {
    // component 文字列を Component 列挙型に変換する
    let comp = match component.as_str() {
        // "verdaccio" を Component::Verdaccio に変換する
        "verdaccio" => Component::Verdaccio,
        // "backstage" を Component::Backstage に変換する
        "backstage" => Component::Backstage,
        // "baget" を Component::BaGet に変換する
        "baget" => Component::BaGet,
        // "postgres" を Component::Postgres に変換する
        "postgres" => Component::Postgres,
        // "sqlserver" を Component::SqlServer に変換する
        "sqlserver" => Component::SqlServer,
        // 未知のコンポーネント名の場合はエラーを返す
        other => return Err(format!("未知のコンポーネント: {}", other)),
    };

    // setup.toml から設定を読み込む（存在しない場合はデフォルトにフォールバックする）
    // デフォルト設定を使用するとユーザーが変更した service_prefix が無視されるため
    let config_path = paths::config_file();
    let config = if config_path.exists() {
        SetupConfig::from_file(&config_path).unwrap_or_default()
    } else {
        SetupConfig::default()
    };
    // コンポーネントに対応するエンジンを取得する（後で matches! で比較するため clone する）
    let engine = engine_for(comp.clone());
    // エンジンからサービス名を取得する
    let service_name = engine.service_name(&config);

    // SQL Server は NSSM 管理下にないため sc.exe で直接操作する
    if matches!(comp, Component::SqlServer) {
        // action に応じて sc.exe を呼び出す
        return match action.as_str() {
            // "start" の場合は sc.exe start でサービスを起動する
            "start" => sc_invoke(&service_name, "start", "起動"),
            // "stop" の場合は sc.exe stop でサービスを停止する
            "stop" => sc_invoke(&service_name, "stop", "停止"),
            // "restart" の場合は sc.exe stop → start でサービスを再起動する
            "restart" => {
                // 停止失敗は無視する（既に停止中の可能性があるため）
                let _ = sc_invoke(&service_name, "stop", "停止");
                // 再度起動する
                sc_invoke(&service_name, "start", "再起動")
            }
            // 未知のアクション名の場合はエラーを返す
            other => Err(format!("未知のアクション: {}", other)),
        };
    }

    // NSSM インスタンスを環境変数から自動解決して作成する
    let nssm = Nssm::from_env()
        // NSSM が見つからない場合はエラーメッセージをフロントエンドに返す
        .map_err(|e| format!("NSSM の取得に失敗しました: {}", e))?;

    // action 文字列に基づいてサービス操作を実行する
    match action.as_str() {
        // "start" の場合はサービスを開始する
        "start" => nssm
            .start(&service_name)
            // サービス開始失敗をエラーメッセージに変換して返す
            .map_err(|e| format!("サービスの開始に失敗しました: {}", e)),
        // "stop" の場合はサービスを停止する
        "stop" => nssm
            .stop(&service_name)
            // サービス停止失敗をエラーメッセージに変換して返す
            .map_err(|e| format!("サービスの停止に失敗しました: {}", e)),
        // "restart" の場合はサービスを停止してから開始する
        "restart" => {
            // まずサービスを停止する（既に停止中の場合のエラーは無視する）
            let _ = nssm.stop(&service_name);
            // サービスを開始する
            nssm.start(&service_name)
                // サービス開始失敗をエラーメッセージに変換して返す
                .map_err(|e| format!("サービスの再起動に失敗しました: {}", e))
        }
        // 未知のアクション名の場合はエラーを返す
        other => Err(format!("未知のアクション: {}", other)),
    }
}

// sc.exe <action> <service_name> を実行するヘルパー関数（SQL Server 用）
// op_label: 日本語のエラーメッセージで使用する操作名（例: "起動" / "停止" / "再起動"）
fn sc_invoke(service_name: &str, action: &str, op_label: &str) -> Result<(), String> {
    // sc.exe を起動する
    let output = Command::new("sc.exe")
        // start / stop などのサブコマンドを指定する
        .arg(action)
        // 対象サービス名を指定する
        .arg(service_name)
        // 実行する
        .output()
        .map_err(|e| format!("sc.exe の実行に失敗しました: {}", e))?;

    // 終了コードが 0 でない場合は操作失敗として UI に返す。
    if !output.status.success() {
        let details = format_sc_output(&output);
        return Err(format!(
            "サービスの{}に失敗しました（sc.exe 終了コード: {:?}）{}",
            op_label,
            output.status.code(),
            details
        ));
    }

    // 正常終了として扱う
    Ok(())
}

fn format_sc_output(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = [stdout, stderr]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if combined.is_empty() {
        String::new()
    } else {
        format!(": {}", combined)
    }
}
