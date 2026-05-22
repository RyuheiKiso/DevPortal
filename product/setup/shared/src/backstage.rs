// このファイルは Backstage 開発者ポータルの SetupEngine 実装を定義する
// NSSM を使って Backstage を Windows サービスとしてインストール・管理する

// ファイルシステム操作に必要な型をインポートする
use std::fs;

// ネットワーク接続確認に必要な型をインポートする
use std::net::TcpStream;

// 標準時間型をインポートする（タイムアウト・待機処理に使用）
use std::time::Duration;

// 独自エラー型を参照するために使用する
use crate::error::SetupError;

// 進捗イベント送信と型を参照するために使用する
use crate::event::{ActionKind, Component, Reporter};

// セットアップ設定構造体と Backstage モードを参照するために使用する
use crate::config::{BackstageMode, SetupConfig};

// コンポーネントステータス構造体と SetupEngine トレイトを参照するために使用する
use crate::engine::{ComponentStatus, SetupEngine};

// NSSM ラッパ構造体を参照するために使用する
use crate::nssm::Nssm;

// パス解決関数を参照するために使用する
use crate::paths;

// コマンド実行ユーティリティを参照するために使用する
use crate::process::{build_command, run_streaming};

// BackstageEngine: Backstage 開発者ポータルの SetupEngine 実装構造体
// フィールドを持たないユニット構造体として定義する
pub struct BackstageEngine;

// BackstageEngine のプライベートヘルパーメソッド実装ブロック
impl BackstageEngine {
    // ヘルスチェックを TCP 接続で実施するヘルパーメソッド
    // 最大 max_retries 回リトライし、成功したら true を返す
    fn wait_for_tcp(host: &str, port: u16, max_retries: u32, interval_secs: u64) -> bool {
        // 接続先のアドレス文字列を構築する
        let addr = format!("{}:{}", host, port);
        // リトライ回数をカウントする変数
        let mut attempt = 0u32;
        // 最大リトライ回数に達するまでループする
        while attempt < max_retries {
            // TCP 接続タイムアウトを設定する（interval_secs の半分 + 1 秒）
            let timeout = Duration::from_secs(interval_secs / 2 + 1);
            // TcpStream::connect_timeout で TCP 接続を確認する
            if TcpStream::connect_timeout(
                // アドレスを SocketAddr にパースして渡す
                &addr.parse().unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap()),
                // タイムアウト時間を設定する
                timeout,
            )
            .is_ok()
            {
                // 接続に成功したら true を返す
                return true;
            }
            // 接続に失敗した場合は指定秒数待機してからリトライする
            std::thread::sleep(Duration::from_secs(interval_secs));
            // リトライカウントをインクリメントする
            attempt += 1;
        }
        // 最大リトライ回数に達しても接続できなかった場合は false を返す
        false
    }

    // app-config.yaml のポート番号を serde_yaml を使って更新するヘルパーメソッド
    // 失敗しても続行するため Result は返さずに Reporter へ警告を出す
    fn update_app_config_ports(
        config: &SetupConfig,
        reporter: &Reporter,
    ) {
        // app-config.yaml のパスを構築する
        let app_config_path = paths::backstage_app_dir(config).join("app-config.yaml");
        // app-config.yaml が存在しない場合は何もしない
        if !app_config_path.exists() {
            // ファイルが存在しない場合は警告を出して終了する
            reporter.warn(None, "app-config.yaml が見つかりません。ポート設定をスキップします。");
            return;
        }

        // app-config.yaml のファイル内容を読み込む
        let content = match fs::read_to_string(&app_config_path) {
            // 読み込み成功の場合は内容を使用する
            Ok(c) => c,
            // 読み込み失敗の場合は警告を出して終了する
            Err(e) => {
                // 読み込みエラーを警告として報告する
                reporter.warn(None, format!("app-config.yaml の読み込みに失敗しました: {}", e));
                return;
            }
        };

        // serde_yaml で Value としてパースする
        let mut yaml_value: serde_yaml::Value = match serde_yaml::from_str(&content) {
            // パース成功の場合は Value を使用する
            Ok(v) => v,
            // パース失敗の場合は警告を出して終了する
            Err(e) => {
                // YAML パースエラーを警告として報告する
                reporter.warn(None, format!("app-config.yaml のパースに失敗しました: {}", e));
                return;
            }
        };

        // backend.listen.port を更新する
        let backend_port = config.backstage.backend_port;
        // app.baseUrl と backend.baseUrl のポートを更新する
        let frontend_port = config.backstage.frontend_port;

        // backend.listen.port を更新する（パスが存在しない場合はスキップ）
        if let serde_yaml::Value::Mapping(ref mut map) = yaml_value {
            // backend キーを取得する
            if let Some(backend) = map.get_mut("backend") {
                // backend が Mapping の場合に処理する
                if let serde_yaml::Value::Mapping(ref mut backend_map) = backend {
                    // listen キーを取得する
                    if let Some(listen) = backend_map.get_mut("listen") {
                        // listen が Mapping の場合に port を更新する
                        if let serde_yaml::Value::Mapping(ref mut listen_map) = listen {
                            // port キーの値を更新する
                            listen_map.insert(
                                // port というキーを設定する
                                serde_yaml::Value::String("port".to_string()),
                                // バックエンドポート番号を数値として設定する
                                serde_yaml::Value::Number(serde_yaml::Number::from(backend_port)),
                            );
                        }
                    }
                }
            }
            // app.baseUrl を更新する
            if let Some(app) = map.get_mut("app") {
                // app が Mapping の場合に baseUrl を更新する
                if let serde_yaml::Value::Mapping(ref mut app_map) = app {
                    // baseUrl の値を更新する（フロントエンドポート）
                    app_map.insert(
                        // baseUrl というキーを設定する
                        serde_yaml::Value::String("baseUrl".to_string()),
                        // フロントエンドの URL を設定する
                        serde_yaml::Value::String(format!("http://localhost:{}", frontend_port)),
                    );
                }
            }
            // backend.baseUrl を更新する
            if let Some(backend) = map.get_mut("backend") {
                // backend が Mapping の場合に baseUrl を更新する
                if let serde_yaml::Value::Mapping(ref mut backend_map) = backend {
                    // baseUrl の値を更新する（バックエンドポート）
                    backend_map.insert(
                        // baseUrl というキーを設定する
                        serde_yaml::Value::String("baseUrl".to_string()),
                        // バックエンドの URL を設定する
                        serde_yaml::Value::String(format!("http://localhost:{}", backend_port)),
                    );
                }
            }
        }

        // 更新した YAML を文字列にシリアライズする
        let updated_content = match serde_yaml::to_string(&yaml_value) {
            // シリアライズ成功の場合は文字列を使用する
            Ok(s) => s,
            // シリアライズ失敗の場合は警告を出して終了する
            Err(e) => {
                // シリアライズエラーを警告として報告する
                reporter.warn(None, format!("app-config.yaml のシリアライズに失敗しました: {}", e));
                return;
            }
        };

        // 更新した内容を app-config.yaml に書き込む
        if let Err(e) = fs::write(&app_config_path, updated_content) {
            // 書き込みエラーを警告として報告する
            reporter.warn(None, format!("app-config.yaml の書き込みに失敗しました: {}", e));
        }
    }
}

// SetupEngine トレイトの BackstageEngine への実装
impl SetupEngine for BackstageEngine {
    // コンポーネント名を返す（ログ表示用）
    fn name(&self) -> &str {
        // Backstage コンポーネントの表示名を返す
        "Backstage"
    }

    // Windows サービスの識別名を返す
    // config.service_prefix と "Backstage" を連結した名前を使用する
    fn service_name(&self, config: &SetupConfig) -> String {
        // サービスプレフィックスと Backstage を連結してサービス名を生成する
        format!("{}-Backstage", config.service_prefix)
    }

    // Backstage をインストールして Windows サービスとして登録する
    fn install(&self, config: &SetupConfig, reporter: &Reporter) -> Result<(), SetupError> {
        // Build モードは未実装のためエラーを返す
        if config.backstage.mode == BackstageMode::Build {
            // Build モードは現時点では未実装であることを示すエラーを返す
            return Err(SetupError::Other("Build モードは未実装です".to_string()));
        }

        // サービス名を取得する
        let service_name = self.service_name(config);

        // 前提条件チェックを実行する（node/npm/npx/yarn/git が必要）
        let prereq = crate::prereq::check_prereqs();
        // 必須コマンドのリストを定義する
        let required = ["node", "npm", "npx", "yarn", "git"];
        // 各必須コマンドが存在するか確認する
        for cmd_name in &required {
            // コマンドが見つからない場合はエラーを返す
            if !prereq.items.iter().any(|i| i.name == *cmd_name && i.found) {
                // 必須コマンドが見つからない場合は PrereqMissing エラーを返す
                return Err(SetupError::PrereqMissing(cmd_name.to_string()));
            }
        }

        // ステップ 1: 必要なディレクトリを作成する
        reporter.info("Backstage インストールディレクトリを作成しています...");

        // Backstage のルートディレクトリを取得する
        let backstage_root = paths::backstage_root(config);
        // Backstage のログ出力ディレクトリを取得する
        let logs_dir = paths::backstage_logs_dir(config);

        // backstage ルートディレクトリを再帰的に作成する
        fs::create_dir_all(&backstage_root)?;
        // logs ディレクトリを再帰的に作成する
        fs::create_dir_all(&logs_dir)?;

        // ステップ 2: create-app を実行して Backstage アプリを生成する
        reporter.step_start("create_app", "Backstage アプリを生成しています（時間がかかります）", 7, 0);

        // npx @backstage/create-app コマンドを構築する
        // --path app でアプリディレクトリ名を指定する
        let backstage_root_str = backstage_root.to_string_lossy().to_string();
        // npx コマンドを build_command で構築する
        let mut create_cmd = build_command(
            "npx",
            &[
                "--yes",
                "@backstage/create-app@latest",
                "--path",
                "app",
            ],
        );
        // 作業ディレクトリを backstage_root に設定する
        create_cmd.current_dir(&backstage_root_str);
        // stdin をパイプに設定してアプリ名を自動入力する
        create_cmd.stdin(std::process::Stdio::piped());

        // create-app コマンドをストリーミング実行する
        // stdin 入力が必要なため手動で起動してパイプに書き込む
        create_cmd.stdout(std::process::Stdio::piped());
        // stderr もパイプに設定する
        create_cmd.stderr(std::process::Stdio::piped());
        // コマンドを起動して子プロセスを取得する
        let mut child = create_cmd.spawn().map_err(SetupError::Io)?;

        // stdin パイプにアプリ名（"app\n"）を書き込む
        if let Some(mut stdin) = child.stdin.take() {
            // stdin にアプリ名を書き込む（create-app のプロンプトへの回答）
            use std::io::Write;
            // アプリ名として "app" を改行付きで送信する
            let _ = stdin.write_all(b"app\n");
            // stdin を閉じてプロセスに EOF を通知する
        }

        // stdout を reporter に転送しながら処理を待つ
        let stdout_handle = child.stdout.take();
        // stderr を取得する
        let stderr_handle = child.stderr.take();

        // stderr を別スレッドで読み取る
        let stderr_thread = if let Some(stderr) = stderr_handle {
            // stderr の行を収集するスレッドを起動する
            let handle = std::thread::spawn(move || {
                // バッファリードを作成する
                use std::io::BufRead;
                // stderr のリーダーを作成する
                let reader = std::io::BufReader::new(stderr);
                // 各行を収集するベクタ
                let mut lines = Vec::new();
                // 各行を読み取って収集する
                for line in reader.lines().flatten() {
                    // 行をベクタに追加する
                    lines.push(line);
                }
                // 収集した行を返す
                lines
            });
            // スレッドハンドルを Some に包んで返す
            Some(handle)
        } else {
            // stderr が取得できない場合は None を返す
            None
        };

        // stdout をメインスレッドで読み取って reporter に送信する
        if let Some(stdout) = stdout_handle {
            // バッファリードを作成する
            use std::io::BufRead;
            // stdout のリーダーを作成する
            let reader = std::io::BufReader::new(stdout);
            // 各行を読み取って reporter に送信する
            for line in reader.lines().flatten() {
                // stdout の行を reporter に送信する
                reporter.stdout_line("create_app", &line);
            }
        }

        // stderr スレッドの完了を待って収集した行を reporter に送信する
        if let Some(handle) = stderr_thread {
            // スレッドの完了を待つ
            if let Ok(lines) = handle.join() {
                // 収集した各行を reporter に送信する
                for line in lines {
                    // stderr の行を reporter に送信する
                    reporter.stderr_line("create_app", &line);
                }
            }
        }

        // 子プロセスの終了を待って終了ステータスを確認する
        let status = child.wait().map_err(SetupError::Io)?;
        // 終了コードが 0 以外の場合はエラーを返す
        if !status.success() {
            // create-app の失敗を CommandFailed エラーとして返す
            return Err(SetupError::CommandFailed {
                // コマンド名を格納する
                cmd: "npx @backstage/create-app".to_string(),
                // 終了コードを取得する（取得できない場合は -1 を使用）
                code: status.code().unwrap_or(-1),
            });
        }

        // ステップ 3: yarn install を実行して依存関係をインストールする
        reporter.step_start("yarn_install", "yarn install を実行しています", 7, 1);
        // Backstage アプリディレクトリを取得する
        let app_dir = paths::backstage_app_dir(config);
        // app_dir の文字列を取得する
        let app_dir_str = app_dir.to_string_lossy().to_string();
        // yarn install コマンドを構築する（ネットワークタイムアウトを 600 秒に設定）
        let mut yarn_install_cmd = build_command(
            "yarn",
            &[
                "install",
                "--network-timeout",
                "600000",
            ],
        );
        // 作業ディレクトリを app_dir に設定する
        yarn_install_cmd.current_dir(&app_dir_str);
        // yarn install をストリーミング実行する
        run_streaming(yarn_install_cmd, "yarn_install", reporter)?;

        // ステップ 4: フロントエンドをビルドする
        // production モードでは backend が packages/app/dist/ の静的ファイルを serve する
        // yarn build を実行しないと GET / が 404 になりブラウザから UI にアクセスできない
        reporter.step_start("yarn_build", "フロントエンドをビルドしています（数分かかります）", 7, 2);
        // yarn build コマンドを構築する
        let mut yarn_build_cmd = build_command("yarn", &["build"]);
        // 作業ディレクトリを app_dir に設定する
        yarn_build_cmd.current_dir(&app_dir_str);
        // yarn build をストリーミング実行する
        run_streaming(yarn_build_cmd, "yarn_build", reporter)?;

        // ステップ 5: app-config.yaml のポート番号を更新する
        reporter.info("app-config.yaml のポート設定を更新しています...");
        // ポート設定の更新（失敗しても続行するためエラーは reporter に警告として出力）
        Self::update_app_config_ports(config, reporter);

        // ステップ 6: NSSM を確保する（キャッシュがあれば即時、なければ HTTP 動的取得）
        reporter.step_start("nssm_fetch", "NSSM を確保しています", 7, 3);
        // Nssm::ensure はキャッシュ確認 → 必要なら自動ダウンロードを行う
        let nssm = Nssm::ensure(reporter)?;
        // NSSM サービス登録ステップを開始する
        reporter.step_start("nssm_install", "NSSM サービス登録", 7, 3);
        // backend_port を文字列に変換する
        let backend_port_str = config.backstage.backend_port.to_string();

        // Dev モードの場合: yarn workspace backend start を使用する
        // Windows では cmd.exe 経由になるため、nssm には cmd.exe を実行ファイルとして指定する
        let cmd_exe = "cmd.exe";

        // nssm install でサービスを登録する（引数なし）
        // NSSM 2.24 は追加引数を install に渡すと Parameters レジストリが壊れる場合があるため
        // AppParameters は直後の nssm set で別途設定する
        nssm.install(&service_name, cmd_exe, reporter)?;

        // AppParameters を設定する（cmd /c yarn workspace backend start）
        nssm.set(&service_name, "AppParameters", "/c yarn workspace backend start")?;

        // ステップ 7: NSSM でサービスの詳細設定を行う
        reporter.step_start("nssm_configure", "NSSM サービス設定", 7, 4);
        // ログファイルのパスを構築する
        let stdout_log = logs_dir.join("backstage-stdout.log");
        // stderr ログファイルのパスを構築する
        let stderr_log = logs_dir.join("backstage-stderr.log");
        // stdout ログパスの文字列を取得する
        let stdout_log_str = stdout_log.to_string_lossy().to_string();
        // stderr ログパスの文字列を取得する
        let stderr_log_str = stderr_log.to_string_lossy().to_string();

        // サービスの詳細設定を一括で行う
        nssm.configure_service(
            // サービス名を指定する
            &service_name,
            // 表示名を指定する
            "DevPortal - Backstage Developer Portal",
            // 説明文を指定する
            "DevPortal が管理する Backstage 開発者ポータル",
            // 作業ディレクトリを app_dir に設定する
            &app_dir_str,
            // 標準出力ログファイルを指定する
            &stdout_log_str,
            // 標準エラーログファイルを指定する
            &stderr_log_str,
            // 追加環境変数（production モードで backend が app/dist/ の静的ファイルを serve する）
            &[
                ("NODE_ENV", "production"),
                ("PORT", &backend_port_str),
            ],
        )?;

        // AppThrottle を追加で設定する（スロットリング 60 秒）
        nssm.set(&service_name, "AppThrottle", "60000")?;

        // ステップ 8: サービスを起動する
        reporter.step_start("service_start", "サービスを起動しています", 7, 5);
        // sc.exe start でサービスを起動する（起動完了はヘルスチェックで確認する）
        nssm.start(&service_name)?;

        // ステップ 9: ヘルスチェックを実施する（最大 100 回・3 秒ごと = 最大 300 秒）
        reporter.step_start("health_check", "ヘルスチェック待機中（最大 5 分）", 7, 6);
        // Backstage バックエンドポートへの TCP 接続確認
        let backend_port = config.backstage.backend_port;
        // TCP 接続で Backstage が応答するまで待機する
        let reachable = Self::wait_for_tcp("127.0.0.1", backend_port, 100, 3);
        // ヘルスチェック結果をログに記録する
        if reachable {
            // 接続成功をログに記録する
            reporter.info(format!(
                "Backstage バックエンドがポート {} で応答しています",
                backend_port
            ));
        } else {
            // 接続失敗を警告としてログに記録する（サービス起動は成功しているため続行）
            reporter.warn(
                None,
                format!(
                    "Backstage のヘルスチェックがタイムアウトしました（ポート {}）",
                    backend_port
                ),
            );
        }

        // インストール完了イベントを送信する
        reporter.finished(
            // Backstage コンポーネントの完了を通知する
            Component::Backstage,
            // インストール操作の完了を通知する
            ActionKind::Install,
            // 完了の要約テキストを生成する
            format!(
                "Backstage を Windows サービス '{}' としてインストールしました（バックエンドポート {}）",
                service_name, backend_port
            ),
        );

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // Backstage をアンインストールする
    fn uninstall(
        &self,
        config: &SetupConfig,
        reporter: &Reporter,
        keep_data: bool,
    ) -> Result<(), SetupError> {
        // サービス名を取得する
        let service_name = self.service_name(config);
        // NSSM を確保する（キャッシュがあれば即時、なければ HTTP 動的取得）
        let nssm = Nssm::ensure(reporter)?;

        // サービスを停止する（失敗しても続行する）
        reporter.info("Backstage サービスを停止しています...");
        // stop の失敗は無視する（既に停止済みの可能性があるため）
        let _ = nssm.stop(&service_name);

        // サービスを削除する
        reporter.info("Backstage サービスを削除しています...");
        // サービス削除に失敗した場合はエラーを返す
        nssm.remove(&service_name)?;

        // データ保持フラグに応じてディレクトリを削除する
        if keep_data {
            // keep_data = true のとき backstage_app_dir のみ削除してデータは backstage_root に残す
            // MVP: とりあえず backstage_app_dir のみ削除、データは backstage_root に残す
            reporter.info("Backstage app ディレクトリを削除しています（データは保持）...");
            // app ディレクトリのパスを取得する
            let app_dir = paths::backstage_app_dir(config);
            // app_dir が存在する場合のみ削除する
            if app_dir.exists() {
                // app ディレクトリを再帰的に削除する
                fs::remove_dir_all(&app_dir)?;
            }
        } else {
            // keep_data = false のとき backstage_root 全体を削除する
            reporter.info("Backstage データディレクトリを全て削除しています...");
            // backstage のルートディレクトリを取得する
            let backstage_root = paths::backstage_root(config);
            // ディレクトリが存在する場合のみ削除する
            if backstage_root.exists() {
                // backstage ルートディレクトリを再帰的に削除する
                fs::remove_dir_all(&backstage_root)?;
            }
        }

        // アンインストール完了イベントを送信する
        reporter.finished(
            // Backstage コンポーネントの完了を通知する
            Component::Backstage,
            // アンインストール操作の完了を通知する
            ActionKind::Uninstall,
            // 完了の要約テキストを生成する
            format!(
                "Backstage サービス '{}' のアンインストールが完了しました",
                service_name
            ),
        );

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // Backstage の現在の状態を返す
    fn status(&self, config: &SetupConfig) -> Result<ComponentStatus, SetupError> {
        // サービス名を取得する
        let service_name = self.service_name(config);
        // NSSM を使ってサービスの状態を取得する
        let nssm_result = Nssm::from_env();
        // サービスの状態を取得する
        let service_status = match nssm_result {
            // NSSM が利用可能な場合はサービス状態を取得する
            Ok(nssm) => nssm.status(&service_name),
            // NSSM が利用できない場合は winsvc を直接使用する
            Err(_) => crate::winsvc::query_service_status(&service_name),
        };

        // Backstage バックエンドポートを取得する
        let port = config.backstage.backend_port;
        // TCP 接続でエンドポイントの生死確認を行う
        let endpoint_reachable = TcpStream::connect_timeout(
            // 接続先アドレスを構築する
            &format!("127.0.0.1:{}", port)
                .parse()
                .unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap()),
            // タイムアウトを 2 秒に設定する
            Duration::from_secs(2),
        )
        .is_ok();

        // エンドポイント URL を構築する（Backstage バックエンドの API URL）
        let endpoint_url = format!("http://127.0.0.1:{}/api/catalog/health", port);
        // アプリディレクトリの存在確認を行う
        let data_dir_exists = paths::backstage_app_dir(config).exists();

        // ComponentStatus を構築して返す
        Ok(ComponentStatus {
            // Backstage コンポーネントを指定する
            component: Component::Backstage,
            // サービス名を格納する
            service_name,
            // サービスの状態を格納する
            service_status,
            // エンドポイント到達可否を格納する
            endpoint_reachable,
            // エンドポイント URL を格納する
            endpoint_url,
            // データディレクトリの存在確認結果を格納する
            data_dir_exists,
        })
    }
}
