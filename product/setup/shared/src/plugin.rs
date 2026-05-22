// このファイルは Backstage プラグインの一覧取得・インストール・削除ロジックを実装する
// SetupEvent と Reporter を使って進捗を GUI/CLI に通知する

// ファイルシステムパスを扱うために PathBuf を使用する
use std::path::PathBuf;

// セットアップエラー型を参照するために使用する
use crate::error::SetupError;

// 進捗イベント送信に必要な型をインポートする
use crate::event::{ActionKind, Component, Reporter};

// セットアップ設定構造体を参照するために使用する
use crate::config::SetupConfig;

// Backstage アプリのパスを解決するために使用する
use crate::paths::backstage_app_dir;

// コマンド実行ユーティリティをインポートする
use crate::process::{build_command, run_streaming};

// マーカー操作モジュールをインポートする
use crate::plugin_markers::{
    ensure_markers, insert_plugin, remove_plugin, MarkerError, PluginKind, PluginRegistration,
};

// NSSM ラッパーをインポートする（サービス再起動に使用する）
use crate::nssm::Nssm;

// InstalledPlugin: インストール済みプラグインの情報を表す構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstalledPlugin {
    // npm パッケージ名（例: @backstage/plugin-kubernetes）
    pub name: String,
    // インストールされているバージョン文字列
    pub version: String,
    // プラグインの適用対象種別（Frontend / Backend）
    pub kind: PluginKind,
}

// PluginInstallRequest: プラグインインストール要求を表す構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PluginInstallRequest {
    // インストールする npm パッケージ名
    pub package_name: String,
    // プラグインの適用対象種別
    pub kind: PluginKind,
}

// PluginRemoveRequest: プラグイン削除要求を表す構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PluginRemoveRequest {
    // 削除する npm パッケージ名
    pub package_name: String,
    // プラグインの適用対象種別
    pub kind: PluginKind,
}

// インストール済みプラグインの一覧を返す関数
// packages/app/package.json と packages/backend/package.json の dependencies を読んで
// @backstage/plugin-* または backstage-plugin-* パターンの依存を抽出する
pub fn list(config: &SetupConfig) -> Result<Vec<InstalledPlugin>, SetupError> {
    // Backstage アプリのルートディレクトリを取得する
    let app_dir = backstage_app_dir(config);
    // インストール済みプラグインのリストを格納するベクタ
    let mut plugins: Vec<InstalledPlugin> = Vec::new();

    // packages/app/package.json からフロントエンドプラグインを読み込む
    let app_pkg_path = app_dir.join("packages").join("app").join("package.json");
    // フロントエンドパッケージが存在する場合は dependencies を読み込む
    if app_pkg_path.exists() {
        // package.json の dependencies からプラグインを抽出して追加する
        let mut frontend_plugins =
            extract_plugins_from_package(&app_pkg_path, PluginKind::Frontend)?;
        // フロントエンドプラグインをリストに追加する
        plugins.append(&mut frontend_plugins);
    }

    // packages/backend/package.json からバックエンドプラグインを読み込む
    let backend_pkg_path = app_dir
        .join("packages")
        .join("backend")
        .join("package.json");
    // バックエンドパッケージが存在する場合は dependencies を読み込む
    if backend_pkg_path.exists() {
        // package.json の dependencies からプラグインを抽出して追加する
        let mut backend_plugins =
            extract_plugins_from_package(&backend_pkg_path, PluginKind::Backend)?;
        // バックエンドプラグインをリストに追加する
        plugins.append(&mut backend_plugins);
    }

    // プラグインのリストを返す
    Ok(plugins)
}

// package.json の dependencies セクションからプラグイン依存を抽出するヘルパー関数
fn extract_plugins_from_package(
    path: &PathBuf,
    kind: PluginKind,
) -> Result<Vec<InstalledPlugin>, SetupError> {
    // package.json ファイルを文字列として読み込む
    let content = std::fs::read_to_string(path).map_err(SetupError::Io)?;
    // JSON をパースして Value に変換する
    let json: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| SetupError::Other(e.to_string()))?;

    // dependencies オブジェクトを取得する（存在しない場合は空リストを返す）
    let deps = match json.get("dependencies").and_then(|v| v.as_object()) {
        // dependencies が存在する場合はそれを使用する
        Some(d) => d,
        // 存在しない場合は空のリストを返す
        None => return Ok(Vec::new()),
    };

    // プラグインのリストを格納するベクタ
    let mut plugins: Vec<InstalledPlugin> = Vec::new();
    // 各依存エントリを処理する
    for (name, version_val) in deps {
        // Backstage プラグインパターンに合致するか確認する
        if !is_backstage_plugin_name(name) {
            // 対象外のパッケージはスキップする
            continue;
        }
        // バージョン文字列を取得する（取得できない場合は "unknown" を使う）
        let version = version_val.as_str().unwrap_or("unknown").to_string();
        // InstalledPlugin を作成してリストに追加する
        plugins.push(InstalledPlugin {
            // パッケージ名を格納する
            name: name.clone(),
            // バージョン文字列を格納する
            version,
            // プラグイン種別を格納する
            kind: kind.clone(),
        });
    }
    // プラグインのリストを返す
    Ok(plugins)
}

// パッケージ名が Backstage プラグインのパターンに合致するか確認するヘルパー関数
fn is_backstage_plugin_name(name: &str) -> bool {
    // @backstage/plugin-* パターン
    if name.starts_with("@backstage/plugin-") {
        return true;
    }
    // その他のスコープの backstage-plugin-* パターン（コミュニティプラグイン）
    if name.contains("/backstage-plugin-") {
        return true;
    }
    // スコープなしの backstage-plugin-* パターン
    if name.starts_with("backstage-plugin-") {
        return true;
    }
    // いずれのパターンにも合致しない場合は false を返す
    false
}

// プラグインをインストールする関数
// 7 ステップで進捗イベントを Reporter に送信する
// 失敗した場合は Reporter::failed を発火してエラーを返す
pub fn install(
    config: &SetupConfig,
    reporter: &Reporter,
    request: &PluginInstallRequest,
) -> Result<(), SetupError> {
    // Backstage アプリのルートディレクトリを取得する
    let app_dir = backstage_app_dir(config);
    // Backstage がインストールされているか確認する
    if !app_dir.exists() {
        // インストールされていない場合はエラーを返す
        return Err(SetupError::Other(
            "Backstage がインストールされていません。先に Backstage をインストールしてください。"
                .to_string(),
        ));
    }

    // ステップ数を種別に応じて決定する（Backend は yarn_build ステップがないため 1 少ない）
    let total_steps: u32 = match request.kind {
        // フロントエンドは prereq / yarn_add / marker_ensure / plugin_register / yarn_build / service_restart の 6 ステップ
        PluginKind::Frontend => 6,
        // バックエンドは yarn_build をスキップするため 5 ステップ
        PluginKind::Backend => 5,
    };

    // ステップ 1: 前提条件チェック
    reporter.step_start("prereq", "前提条件を確認しています", total_steps, 0);
    // 前提条件チェックを実行する
    let prereq = crate::prereq::check_prereqs();
    // 前提条件チェックが失敗した場合はエラーを返す
    if !prereq.all_ok {
        // 不足しているコマンド名を収集する
        let missing: Vec<String> = prereq
            .items
            .iter()
            .filter(|i| !i.found)
            .map(|i| i.name.clone())
            .collect();
        // エラーを返す
        return Err(SetupError::Other(format!(
            "必要なコマンドが見つかりません: {}",
            missing.join(", ")
        )));
    }
    // ステップ 1 完了を通知する
    reporter.step_done("prereq", 0);

    // yarn workspace のターゲット名を決定する（フロント = "app", バック = "backend"）
    let workspace_target = match request.kind {
        // フロントエンドプラグインは packages/app workspace に追加する
        PluginKind::Frontend => "app",
        // バックエンドプラグインは packages/backend workspace に追加する
        PluginKind::Backend => "backend",
    };

    // ステップ 2: yarn workspace add でパッケージを追加する
    reporter.step_start(
        "yarn_add",
        &format!(
            "yarn workspace {} add {} を実行しています",
            workspace_target, request.package_name
        ),
        total_steps,
        1,
    );
    // yarn add コマンドを構築する
    let mut yarn_add_cmd = build_command(
        "yarn",
        &["workspace", workspace_target, "add", &request.package_name],
    );
    // Backstage アプリのルートディレクトリで実行する
    yarn_add_cmd.current_dir(&app_dir);
    // コマンドをストリーミング実行する（失敗した場合はここでエラーを返す）
    run_streaming(yarn_add_cmd, "yarn_add", reporter)?;
    // ステップ 2 完了を通知する
    reporter.step_done("yarn_add", 0);

    // ステップ 3: マーカーコメントが存在しない場合はファイルに挿入する
    reporter.step_start(
        "marker_ensure",
        "登録用マーカーをファイルに設定しています",
        total_steps,
        2,
    );
    // マーカー挿入対象のファイルパスを種別に応じて決定する
    let target_file = get_target_file(&app_dir, &request.kind);
    // 対象ファイルが存在する場合のみマーカー挿入を行う
    if target_file.exists() {
        // 対象ファイルの内容を読み込む
        let content = std::fs::read_to_string(&target_file).map_err(SetupError::Io)?;
        // マーカーを挿入したソースを取得する
        match ensure_markers(&content, &request.kind) {
            // マーカー挿入成功の場合はファイルに書き戻す
            Ok(updated) => {
                // 更新後の内容をファイルに書き込む
                std::fs::write(&target_file, updated).map_err(SetupError::Io)?;
            }
            // マーカー挿入に失敗した場合（位置特定不可）はエラーを返す
            // yarn add は完了済みのためパッケージは追加されているが登録コードは未挿入の不整合を防ぐ
            Err(MarkerError::CannotLocate(msg)) => {
                return Err(SetupError::Other(format!(
                    "マーカーを自動挿入できません（{}）。\
                    {} を手動で編集してプラグインを登録してください。",
                    msg,
                    target_file.to_string_lossy()
                )));
            }
            // 既に登録済みの場合は情報メッセージを出して継続する
            Err(MarkerError::AlreadyRegistered(name)) => {
                // 重複登録の情報を送信する（エラーではない）
                reporter.info(format!(
                    "プラグイン '{}' のマーカーは既に設定済みです",
                    name
                ));
            }
        }
    }
    // ステップ 3 完了を通知する
    reporter.step_done("marker_ensure", 0);

    // ステップ 4: マーカー間にプラグイン登録コードを挿入する
    reporter.step_start(
        "plugin_register",
        "プラグイン登録コードを挿入しています",
        total_steps,
        3,
    );
    // 対象ファイルが存在する場合のみ挿入を行う
    if target_file.exists() {
        // 現在のファイル内容を読み込む
        let content = std::fs::read_to_string(&target_file).map_err(SetupError::Io)?;
        // パッケージ名からプラグイン登録情報を生成する
        let registration = generate_registration(&request.package_name, &request.kind);
        // マーカー間にプラグイン登録コードを挿入する
        match insert_plugin(&content, &registration, &request.kind) {
            // 挿入成功の場合はファイルに書き戻す
            Ok(updated) => {
                // 更新後の内容をファイルに書き込む
                std::fs::write(&target_file, updated).map_err(SetupError::Io)?;
            }
            // 既に登録済みの場合は情報メッセージを出して継続する
            Err(MarkerError::AlreadyRegistered(name)) => {
                // 既に登録済みの旨をログに出力する
                reporter.info(format!("プラグイン '{}' は既に登録されています", name));
            }
            // 挿入位置が特定できない場合はエラーを返す
            Err(MarkerError::CannotLocate(msg)) => {
                return Err(SetupError::Other(format!(
                    "プラグイン登録コードを自動挿入できません（{}）。\
                    {} を手動で編集してください。",
                    msg,
                    target_file.to_string_lossy()
                )));
            }
        }
    }
    // ステップ 4 完了を通知する
    reporter.step_done("plugin_register", 0);

    // ステップ 5: フロントエンドプラグインの場合のみ再ビルドを行う
    if request.kind == PluginKind::Frontend {
        // ビルドステップの開始を通知する（Frontend 時のみ発火するためインデックスは 4 固定）
        reporter.step_start(
            "yarn_build",
            "フロントエンドをビルドしています（数分かかる場合があります）",
            total_steps,
            4,
        );
        // yarn workspace app build コマンドを構築する
        let mut build_cmd = build_command("yarn", &["workspace", "app", "build"]);
        // Backstage アプリのルートディレクトリで実行する
        build_cmd.current_dir(&app_dir);
        // コマンドをストリーミング実行する
        run_streaming(build_cmd, "yarn_build", reporter)?;
        // ステップ 5 完了を通知する
        reporter.step_done("yarn_build", 0);
    }

    // ステップ 6 (Frontend) / ステップ 5 (Backend): Windows サービスを再起動する
    // Frontend は index=5、Backend は yarn_build がないため index=4
    let restart_index: u32 = match request.kind {
        // フロントエンドは yarn_build の後なので index=5
        PluginKind::Frontend => 5,
        // バックエンドは yarn_build なしなので index=4
        PluginKind::Backend => 4,
    };
    reporter.step_start(
        "service_restart",
        "Backstage サービスを再起動しています",
        total_steps,
        restart_index,
    );
    // サービス名を取得する
    let service_name = format!("{}.Backstage", config.service_prefix);
    // NSSM ラッパーを環境から取得する
    match Nssm::from_env() {
        // NSSM が見つかった場合はサービスを停止・起動する
        Ok(nssm) => {
            // サービスを停止する（失敗は警告に留める）
            if let Err(e) = nssm.stop(&service_name) {
                reporter.warn(
                    Some("service_restart".to_string()),
                    format!("サービス停止に失敗しました（続行します）: {}", e),
                );
            }
            // サービスを起動する（失敗は警告に留める）
            if let Err(e) = nssm.start(&service_name) {
                reporter.warn(
                    Some("service_restart".to_string()),
                    format!(
                        "サービス起動に失敗しました（手動で再起動してください）: {}",
                        e
                    ),
                );
            }
        }
        // NSSM が見つからない場合は警告を出して継続する
        Err(e) => {
            reporter.warn(
                Some("service_restart".to_string()),
                format!("NSSM が見つからないためサービスを再起動できません: {}", e),
            );
        }
    }
    // ステップ 6 完了を通知する
    reporter.step_done("service_restart", 0);

    // 全ステップ完了を通知する
    reporter.finished(
        Component::Backstage,
        ActionKind::Install,
        format!(
            "プラグイン '{}' のインストールが完了しました",
            request.package_name
        ),
    );
    // 正常終了を返す
    Ok(())
}

// プラグインをアンインストールする関数
// 5 ステップで進捗イベントを Reporter に送信する
pub fn remove(
    config: &SetupConfig,
    reporter: &Reporter,
    request: &PluginRemoveRequest,
) -> Result<(), SetupError> {
    // Backstage アプリのルートディレクトリを取得する
    let app_dir = backstage_app_dir(config);
    // Backstage がインストールされているか確認する
    if !app_dir.exists() {
        return Err(SetupError::Other(
            "Backstage がインストールされていません".to_string(),
        ));
    }

    // yarn workspace のターゲット名を決定する
    let workspace_target = match request.kind {
        // フロントエンドプラグインは packages/app workspace から削除する
        PluginKind::Frontend => "app",
        // バックエンドプラグインは packages/backend workspace から削除する
        PluginKind::Backend => "backend",
    };

    // ステップ数を種別に応じて決定する（Backend は yarn_build ステップがないため 1 少ない）
    let total_steps: u32 = match request.kind {
        // フロントエンドは plugin_unregister / yarn_remove / yarn_build / service_restart の 4 ステップ
        PluginKind::Frontend => 4,
        // バックエンドは yarn_build をスキップするため 3 ステップ
        PluginKind::Backend => 3,
    };

    // ステップ 1: マーカー間から登録コードを削除する
    reporter.step_start(
        "plugin_unregister",
        "プラグイン登録コードを削除しています",
        total_steps,
        0,
    );
    // マーカー削除対象のファイルパスを決定する
    let target_file = get_target_file(&app_dir, &request.kind);
    // 対象ファイルが存在する場合のみ削除を行う
    if target_file.exists() {
        // 現在のファイル内容を読み込む
        let content = std::fs::read_to_string(&target_file).map_err(SetupError::Io)?;
        // マーカー間からプラグインの登録コードを削除する
        match remove_plugin(&content, &request.package_name, &request.kind) {
            // 削除成功の場合はファイルに書き戻す
            Ok(updated) => {
                std::fs::write(&target_file, updated).map_err(SetupError::Io)?;
            }
            // マーカーが見つからない場合は警告を出して継続する
            Err(MarkerError::CannotLocate(msg)) => {
                reporter.warn(
                    Some("plugin_unregister".to_string()),
                    format!(
                        "登録コードの自動削除に失敗しました（{}）。手動で削除してください。",
                        msg
                    ),
                );
            }
            // その他のエラーは警告として通知する
            Err(e) => {
                reporter.warn(
                    Some("plugin_unregister".to_string()),
                    format!("登録コードの削除中に警告: {}", e),
                );
            }
        }
    }
    // ステップ 1 完了を通知する
    reporter.step_done("plugin_unregister", 0);

    // ステップ 2: yarn workspace remove でパッケージを削除する
    reporter.step_start(
        "yarn_remove",
        &format!(
            "yarn workspace {} remove {} を実行しています",
            workspace_target, request.package_name
        ),
        total_steps,
        1,
    );
    // yarn remove コマンドを構築する
    let mut yarn_remove_cmd = build_command(
        "yarn",
        &[
            "workspace",
            workspace_target,
            "remove",
            &request.package_name,
        ],
    );
    // Backstage アプリのルートディレクトリで実行する
    yarn_remove_cmd.current_dir(&app_dir);
    // コマンドをストリーミング実行する
    run_streaming(yarn_remove_cmd, "yarn_remove", reporter)?;
    // ステップ 2 完了を通知する
    reporter.step_done("yarn_remove", 0);

    // ステップ 3: フロントエンドプラグインの場合のみ再ビルドを行う
    if request.kind == PluginKind::Frontend {
        // ビルドステップの開始を通知する（Frontend 時のみ発火するためインデックスは 2 固定）
        reporter.step_start(
            "yarn_build",
            "フロントエンドをビルドしています",
            total_steps,
            2,
        );
        // yarn workspace app build コマンドを構築する
        let mut build_cmd = build_command("yarn", &["workspace", "app", "build"]);
        // Backstage アプリのルートディレクトリで実行する
        build_cmd.current_dir(&app_dir);
        // コマンドをストリーミング実行する
        run_streaming(build_cmd, "yarn_build", reporter)?;
        // ステップ 3 完了を通知する
        reporter.step_done("yarn_build", 0);
    }

    // ステップ 4 (Frontend) / ステップ 3 (Backend): Windows サービスを再起動する
    // Frontend は index=3、Backend は yarn_build がないため index=2
    let restart_index: u32 = match request.kind {
        // フロントエンドは yarn_build の後なので index=3
        PluginKind::Frontend => 3,
        // バックエンドは yarn_build なしなので index=2
        PluginKind::Backend => 2,
    };
    reporter.step_start(
        "service_restart",
        "Backstage サービスを再起動しています",
        total_steps,
        restart_index,
    );
    // サービス名を取得する
    let service_name = format!("{}.Backstage", config.service_prefix);
    // NSSM ラッパーを環境から取得する
    match Nssm::from_env() {
        // NSSM が見つかった場合はサービスを停止・起動する
        Ok(nssm) => {
            // サービスを停止する（失敗は警告に留める）
            let _ = nssm.stop(&service_name);
            // サービスを起動する（失敗は警告に留める）
            if let Err(e) = nssm.start(&service_name) {
                reporter.warn(
                    Some("service_restart".to_string()),
                    format!(
                        "サービス起動に失敗しました（手動で再起動してください）: {}",
                        e
                    ),
                );
            }
        }
        // NSSM が見つからない場合は警告を出して継続する
        Err(e) => {
            reporter.warn(
                Some("service_restart".to_string()),
                format!("NSSM が見つからないためサービスを再起動できません: {}", e),
            );
        }
    }
    // ステップ 4 完了を通知する
    reporter.step_done("service_restart", 0);

    // 全ステップ完了を通知する
    reporter.finished(
        Component::Backstage,
        ActionKind::Uninstall,
        format!("プラグイン '{}' の削除が完了しました", request.package_name),
    );
    // 正常終了を返す
    Ok(())
}

// プラグイン種別に応じてマーカー操作対象のファイルパスを返すヘルパー関数
fn get_target_file(app_dir: &PathBuf, kind: &PluginKind) -> PathBuf {
    // プラグイン種別ごとに対象ファイルのパスを返す
    match kind {
        // フロントエンドプラグインは packages/app/src/App.tsx を対象とする
        PluginKind::Frontend => app_dir
            .join("packages")
            .join("app")
            .join("src")
            .join("App.tsx"),
        // バックエンドプラグインは packages/backend/src/index.ts を対象とする
        PluginKind::Backend => app_dir
            .join("packages")
            .join("backend")
            .join("src")
            .join("index.ts"),
    }
}

// パッケージ名からプラグイン登録情報（import行・register行）を生成するヘルパー関数
// ユーザーへのスニペット案内とマーカー挿入の両方で使用する
pub fn generate_registration(package_name: &str, kind: &PluginKind) -> PluginRegistration {
    // プラグイン種別に応じてインポート行と登録行を生成する
    match kind {
        PluginKind::Frontend => {
            // パッケージ名からコンポーネント名（PascalCase）を推定する
            let component_name = package_to_component_name(package_name);
            // ルートパスをパッケージ名から推定する
            let route_path = package_to_route_path(package_name);
            // インポート行を生成する（TODO コメント付き）
            let import_line = format!(
                "import {{ {} }} from '{}'; // TODO: エクスポート名を確認してください",
                component_name, package_name
            );
            // ルート登録行を生成する（TODO コメント付き）
            let register_line = format!(
                "<Route path=\"{}\" element={{<{} />}} /> {{/* TODO: パスとコンポーネント名を確認してください */}}",
                route_path, component_name
            );
            // PluginRegistration を作成して返す
            PluginRegistration {
                package_name: package_name.to_string(),
                import_line,
                register_line,
            }
        }
        PluginKind::Backend => {
            // バックエンドプラグインの登録行を生成する（TODO コメント付き）
            let register_line = format!(
                "backend.add(import('{}')); // TODO: 有効化前に設定を確認してください",
                package_name
            );
            // バックエンドプラグインはインポート行不要
            PluginRegistration {
                package_name: package_name.to_string(),
                import_line: String::new(),
                register_line,
            }
        }
    }
}

// パッケージ名からフロントエンドコンポーネント名を推定するヘルパー関数
// 例: @backstage/plugin-kubernetes → KubernetesPage
fn package_to_component_name(package_name: &str) -> String {
    // スコープと plugin- プレフィックスを取り除いた basename を取得する
    let base = extract_plugin_basename(package_name);
    // ハイフンで分割して各単語を PascalCase に変換する
    let pascal: String = base
        .split('-')
        .map(|word| {
            // 先頭を大文字にして残りはそのまま結合する
            let mut chars = word.chars();
            match chars.next() {
                // 先頭文字を大文字にして残りの文字と結合する
                Some(c) => c.to_uppercase().to_string() + chars.as_str(),
                // 空文字の場合はそのまま返す
                None => String::new(),
            }
        })
        .collect();
    // Page サフィックスを付けて返す
    format!("{}Page", pascal)
}

// パッケージ名からルートパスを推定するヘルパー関数
// 例: @backstage/plugin-kubernetes → /kubernetes
fn package_to_route_path(package_name: &str) -> String {
    // スコープと plugin- プレフィックスを取り除いた basename を取得する
    let base = extract_plugin_basename(package_name);
    // スラッシュを先頭に付けてルートパスとして返す
    format!("/{}", base)
}

// パッケージ名から plugin- プレフィックスを取り除いた basename を返すヘルパー関数
// 例: @backstage/plugin-kubernetes → kubernetes
fn extract_plugin_basename(package_name: &str) -> String {
    // スコープ部分（@backstage/plugin-等）を取り除く
    let without_scope = if package_name.contains('/') {
        // スラッシュの後の部分を取得する
        package_name.split('/').last().unwrap_or(package_name)
    } else {
        // スコープなしの場合はそのまま使用する
        package_name
    };
    // plugin- プレフィックスを取り除く
    without_scope
        .strip_prefix("plugin-")
        .unwrap_or(without_scope)
        .to_string()
}
