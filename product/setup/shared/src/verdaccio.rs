// このファイルは Verdaccio npm レジストリの SetupEngine 実装を定義する
// NSSM を使って Verdaccio を Windows サービスとしてインストール・管理する

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

// セットアップ設定構造体を参照するために使用する
use crate::config::SetupConfig;

// コンポーネントステータス構造体と SetupEngine トレイトを参照するために使用する
use crate::engine::{ComponentStatus, SetupEngine};

// NSSM ラッパ構造体を参照するために使用する
use crate::nssm::Nssm;

// パス解決関数を参照するために使用する
use crate::paths;

// コマンド実行ユーティリティを参照するために使用する
use crate::process::{build_command, run_output, run_streaming};

// Verdaccio の設定ファイルテンプレート（Tera 不使用・文字列リテラルで直接埋め込む）
// {storage_dir} と {port} は str::replace で動的に置換する
const VERDACCIO_CONFIG_TEMPLATE: &str = r#"storage: {storage_dir}
auth:
  htpasswd:
    file: {storage_dir}/htpasswd
    # max_users: -1 はユーザー数を無制限にする設定であり、npm adduser で誰でも追加登録できる
    # 新規登録を完全に禁止したい場合は -1 を 0 に変更する (既存ユーザーのログインには影響しない)
    max_users: -1
security:
  api:
    jwt:
      sign:
        expiresIn: 60d
      verify:
        someProp: [secret]
  web:
    sign:
      expiresIn: 7d
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  '@*/*':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
    proxy: npmjs
  '**':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
    proxy: npmjs
server:
  keepAliveTimeout: 60
middlewares:
  audit:
    enabled: true
listen: 0.0.0.0:{port}
log:
  type: stdout
  format: pretty
  level: http
"#;

// Verdaccio に初期ユーザー (admin/admin) を投入するための htpasswd シード
// bcrypt ハッシュは infra/Verdaccio/storage/htpasswd に格納し、ビルド時に同梱する
// 社内閉鎖環境向けの仮パスワードであり、運用前にユーザー側で変更する前提
const VERDACCIO_HTPASSWD_SEED: &str = include_str!("../../../../infra/Verdaccio/storage/htpasswd");

// VerdaccioEngine: Verdaccio npm レジストリの SetupEngine 実装構造体
// フィールドを持たないユニット構造体として定義する
pub struct VerdaccioEngine;

// VerdaccioEngine のプライベートヘルパーメソッド実装ブロック
impl VerdaccioEngine {
    // ヘルスチェックを TCP 接続で実施するヘルパーメソッド
    // 最大 max_retries 回リトライし、成功したら true を返す
    fn wait_for_tcp(host: &str, port: u16, max_retries: u32, interval_secs: u64) -> bool {
        // 接続先のアドレス文字列を構築する
        let addr = format!("{}:{}", host, port);
        // リトライ回数をカウントする変数
        let mut attempt = 0u32;
        // 最大リトライ回数に達するまでループする
        while attempt < max_retries {
            // TCP 接続を試みる（タイムアウトを interval_secs の半分に設定）
            let timeout = Duration::from_secs(interval_secs / 2 + 1);
            // TcpStream::connect_timeout で TCP 接続を確認する
            if TcpStream::connect_timeout(
                // アドレスを SocketAddr にパースして渡す
                &addr
                    .parse()
                    .unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap()),
                // タイムアウト時間を設定する
                timeout,
            )
            .is_ok()
            {
                // 接続に成功したら true を返す
                return true;
            }
            // 接続に失敗した場合は待機してからリトライする
            std::thread::sleep(Duration::from_secs(interval_secs));
            // リトライカウントをインクリメントする
            attempt += 1;
        }
        // 最大リトライ回数に達しても接続できなかった場合は false を返す
        false
    }
}

// SetupEngine トレイトの VerdaccioEngine への実装
impl SetupEngine for VerdaccioEngine {
    // コンポーネント名を返す（ログ表示用）
    fn name(&self) -> &str {
        // Verdaccio コンポーネントの表示名を返す
        "Verdaccio"
    }

    // Windows サービスの識別名を返す
    // config.service_prefix と "Verdaccio" を連結した名前を使用する
    fn service_name(&self, config: &SetupConfig) -> String {
        // サービスプレフィックスと Verdaccio を連結してサービス名を生成する
        format!("{}-Verdaccio", config.service_prefix)
    }

    // Verdaccio をインストールして Windows サービスとして登録する
    fn install(&self, config: &SetupConfig, reporter: &Reporter) -> Result<(), SetupError> {
        // サービス名を取得する
        let service_name = self.service_name(config);

        // 前提条件チェックを実行する（node/npm が必要）
        let prereq = crate::prereq::check_prereqs();
        // node コマンドが見つからない場合はエラーを返す
        if !prereq.items.iter().any(|i| i.name == "node" && i.found) {
            // node が見つからない場合は PrereqMissing エラーを返す
            return Err(SetupError::PrereqMissing("node".to_string()));
        }
        // npm コマンドが見つからない場合はエラーを返す
        if !prereq.items.iter().any(|i| i.name == "npm" && i.found) {
            // npm が見つからない場合は PrereqMissing エラーを返す
            return Err(SetupError::PrereqMissing("npm".to_string()));
        }

        // ステップ 1: 必要なディレクトリを作成する
        reporter.info("Verdaccio インストールディレクトリを作成しています...");

        // Verdaccio のルートディレクトリを取得する
        let verdaccio_dir = paths::verdaccio_dir(config);
        // Verdaccio の npm パッケージインストール先ディレクトリを取得する
        let app_dir = paths::verdaccio_app_dir(config);
        // Verdaccio のログ出力ディレクトリを取得する
        let logs_dir = paths::verdaccio_logs_dir(config);
        // Verdaccio のストレージディレクトリを取得する
        let storage_dir = paths::verdaccio_storage_dir(config);

        // verdaccio ルートディレクトリを再帰的に作成する
        fs::create_dir_all(&verdaccio_dir)?;
        // app ディレクトリを再帰的に作成する
        fs::create_dir_all(&app_dir)?;
        // logs ディレクトリを再帰的に作成する
        fs::create_dir_all(&logs_dir)?;
        // storage ディレクトリを再帰的に作成する
        fs::create_dir_all(&storage_dir)?;

        // ステップ 1.5: htpasswd の初期シード (admin/admin) を配置する
        // 既存ファイルが存在する場合は運用者の追加ユーザー・パスワード変更を尊重して触らない
        reporter.info("htpasswd の初期ユーザーを確認しています...");
        // storage_dir 内の htpasswd ファイルパスを構築する
        let htpasswd_path = storage_dir.join("htpasswd");
        // ファイルが存在しない、またはインストール中断により 0 バイトになっている場合はシードを書き出す
        // fs::write は非アトミック (truncate → write) のため中断で空ファイルが残ることがある
        // その場合も exists() が true を返すため、サイズも合わせて確認する
        let htpasswd_is_empty = htpasswd_path
            .metadata()
            .map(|m| m.len() == 0)
            .unwrap_or(false);
        // 存在しない場合と 0 バイトの場合の両方でシードを書き出す
        if !htpasswd_path.exists() || htpasswd_is_empty {
            // バイナリに埋め込んだ bcrypt 済みエントリを書き出す
            fs::write(&htpasswd_path, VERDACCIO_HTPASSWD_SEED)?;
            // 書き出し完了をログに記録する (パスワードはログに残さない)
            reporter.info("htpasswd に初期ユーザー 'admin' を作成しました");
        } else {
            // 既存 htpasswd を尊重しシードをスキップしたことを記録する
            reporter.info("htpasswd が既に存在するためシードをスキップしました");
        }

        // ステップ 2: package.json を app_dir に生成する
        reporter.info("package.json を生成しています...");

        // package.json の内容を文字列として定義する
        let package_json = r#"{"name":"devportal-verdaccio-host","private":true,"dependencies":{"verdaccio":"^5"}}"#;
        // app_dir/package.json のパスを構築する
        let package_json_path = app_dir.join("package.json");
        // package.json ファイルを書き込む
        fs::write(&package_json_path, package_json)?;

        // ステップ 3: npm install を実行して verdaccio パッケージをインストールする
        reporter.step_start("npm_install", "npm install (verdaccio)", 6, 0);
        // npm install コマンドを構築する（--prefix で app_dir を指定する）
        let app_dir_str = app_dir.to_string_lossy().to_string();
        // npm install コマンドを build_command で構築する
        let npm_cmd = build_command(
            "npm",
            &[
                "install",
                // --prefix で app_dir を指定する
                "--prefix",
                &app_dir_str,
                // 寄付メッセージを非表示にする
                "--no-fund",
                // セキュリティ監査を無効にする（速度向上）
                "--no-audit",
                // ログレベルを error に設定する（進捗バー等を非表示）
                "--loglevel=error",
            ],
        );
        // npm install をストリーミング実行して進捗を reporter に送信する
        run_streaming(npm_cmd, "npm_install", reporter)?;

        // ステップ 4: Verdaccio の config.yaml を生成する
        reporter.info("Verdaccio 設定ファイルを生成しています...");

        // storage ディレクトリのパス文字列を取得する（Windows パスの \ を / に変換）
        let storage_dir_str = storage_dir
            .to_string_lossy()
            // Windows のバックスラッシュをスラッシュに変換する（YAML 内での互換性のため）
            .replace('\\', "/");
        // config.yaml のパスを取得する
        let config_yaml_path = paths::verdaccio_config_file(config);
        // テンプレートの {storage_dir} をストレージパスに置換する
        let config_content = VERDACCIO_CONFIG_TEMPLATE
            .replace("{storage_dir}", &storage_dir_str)
            // テンプレートの {port} をポート番号に置換する
            .replace("{port}", &config.verdaccio.port.to_string());
        // 生成した設定内容を config.yaml に書き込む
        fs::write(&config_yaml_path, &config_content)?;

        // ステップ 5: node.exe の絶対パスを取得する
        reporter.info("node.exe のパスを取得しています...");

        // node -e でスクリプトモード実行時は式だけでは出力されないため console.log を使う
        let node_exe_raw = run_output(build_command(
            "node",
            &["-e", "console.log(process.execPath)"],
        ))?;
        // 取得したパスの前後の空白と改行を除去する
        let node_exe = node_exe_raw.trim().to_string();

        // ステップ 6: Verdaccio エントリポイントのパスを構築する
        // app_dir/node_modules/.bin/verdaccio または app_dir/node_modules/verdaccio/bin/verdaccio
        let verdaccio_entry = app_dir
            .join("node_modules")
            .join("verdaccio")
            .join("bin")
            .join("verdaccio");
        // エントリポイントのパス文字列を取得する
        let verdaccio_entry_str = verdaccio_entry.to_string_lossy().to_string();
        // config.yaml のパス文字列を取得する
        let config_yaml_str = config_yaml_path.to_string_lossy().to_string();
        // ポート番号を文字列に変換する
        let port_str = config.verdaccio.port.to_string();
        // リッスンアドレスを構築する
        let listen_addr = format!("0.0.0.0:{}", config.verdaccio.port);

        // ステップ 7: NSSM を確保する（キャッシュがあれば即時、なければ HTTP 動的取得）
        reporter.step_start("nssm_fetch", "NSSM を確保しています", 6, 1);
        // Nssm::ensure はキャッシュ確認 → 必要なら自動ダウンロードを行う
        let nssm = Nssm::ensure(reporter)?;
        // NSSM 確保完了を通知する
        reporter.step_start("nssm_install", "NSSM サービス登録", 6, 1);

        // nssm install でサービスを登録する（引数なし）
        // NSSM 2.24 は追加引数を install に渡すと Parameters レジストリが壊れる場合があるため
        // AppParameters は直後の nssm set で別途設定する
        nssm.install(&service_name, &node_exe, reporter)?;

        // AppParameters を設定する（verdaccio エントリポイントと起動引数）
        // パスにスペースが含まれる場合に備えてダブルクォートで囲む
        let app_params = format!(
            "\"{}\" --config \"{}\" --listen {}",
            verdaccio_entry_str, config_yaml_str, listen_addr
        );
        // nssm set AppParameters でノードに渡す引数を設定する
        nssm.set(&service_name, "AppParameters", &app_params)?;

        // ステップ 8: NSSM でサービスの詳細設定を行う
        reporter.step_start("nssm_configure", "NSSM サービス設定", 6, 2);
        // ログファイルのパスを構築する
        let stdout_log = logs_dir.join("verdaccio-stdout.log");
        // stderr ログファイルのパスを構築する
        let stderr_log = logs_dir.join("verdaccio-stderr.log");
        // stdout ログパスの文字列を取得する
        let stdout_log_str = stdout_log.to_string_lossy().to_string();
        // stderr ログパスの文字列を取得する
        let stderr_log_str = stderr_log.to_string_lossy().to_string();
        // app_dir の文字列を取得する
        let app_dir_work = app_dir.to_string_lossy().to_string();

        // サービスの詳細設定を一括で行う
        nssm.configure_service(
            // サービス名を指定する
            &service_name,
            // 表示名を指定する
            "DevPortal - Verdaccio npm Registry",
            // 説明文を指定する
            "DevPortal が管理するプライベート npm レジストリ (Verdaccio)",
            // 作業ディレクトリを指定する
            &app_dir_work,
            // 標準出力ログファイルを指定する
            &stdout_log_str,
            // 標準エラーログファイルを指定する
            &stderr_log_str,
            // 追加環境変数（PORT と NODE_ENV を設定する）
            &[("PORT", &port_str), ("NODE_ENV", "production")],
        )?;

        // ステップ 9: サービスを起動する
        reporter.step_start("service_start", "サービスを起動しています", 6, 3);
        // nssm start でサービスを起動する
        nssm.start(&service_name)?;

        // ステップ 10: HTTP ヘルスチェックを実施する（最大 30 秒・1 秒ごとにリトライ）
        reporter.step_start("health_check", "ヘルスチェック待機中", 6, 4);
        // TCP 接続で Verdaccio が応答するまで待機する
        let reachable = Self::wait_for_tcp("127.0.0.1", config.verdaccio.port, 30, 1);
        // ヘルスチェック結果をログに記録する
        if reachable {
            // 接続成功をログに記録する
            reporter.info(format!(
                "Verdaccio がポート {} で応答しています",
                config.verdaccio.port
            ));
        } else {
            // 接続失敗を警告としてログに記録する（サービス起動は成功しているため続行）
            reporter.warn(
                None,
                format!(
                    "Verdaccio のヘルスチェックがタイムアウトしました（ポート {}）",
                    config.verdaccio.port
                ),
            );
        }

        // ステップ 11: インストール完了イベントを送信する
        reporter.finished(
            // Verdaccio コンポーネントの完了を通知する
            Component::Verdaccio,
            // インストール操作の完了を通知する
            ActionKind::Install,
            // 完了の要約テキストを生成する
            format!(
                "Verdaccio を Windows サービス '{}' としてインストールしました（ポート {}）",
                service_name, config.verdaccio.port
            ),
        );

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // Verdaccio をアンインストールする
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
        reporter.info("Verdaccio サービスを停止しています...");
        // stop の失敗は無視する（既に停止済みの可能性があるため）
        let _ = nssm.stop(&service_name);

        // サービスを削除する
        reporter.info("Verdaccio サービスを削除しています...");
        // サービス削除に失敗した場合はエラーを返す
        nssm.remove(&service_name)?;

        // データ保持フラグに応じてディレクトリを削除する
        if keep_data {
            // keep_data = true のとき app_dir のみ削除してストレージは保持する
            reporter.info("Verdaccio app ディレクトリを削除しています（storage は保持）...");
            // app ディレクトリのみ削除する
            let app_dir = paths::verdaccio_app_dir(config);
            // app_dir が存在する場合のみ削除する
            if app_dir.exists() {
                // app ディレクトリを再帰的に削除する
                fs::remove_dir_all(&app_dir)?;
            }
        } else {
            // keep_data = false のとき verdaccio_dir 全体を削除する
            reporter.info("Verdaccio データディレクトリを全て削除しています...");
            // verdaccio のルートディレクトリを取得する
            let verdaccio_dir = paths::verdaccio_dir(config);
            // ディレクトリが存在する場合のみ削除する
            if verdaccio_dir.exists() {
                // verdaccio ディレクトリ全体を再帰的に削除する
                fs::remove_dir_all(&verdaccio_dir)?;
            }
        }

        // アンインストール完了イベントを送信する
        reporter.finished(
            // Verdaccio コンポーネントの完了を通知する
            Component::Verdaccio,
            // アンインストール操作の完了を通知する
            ActionKind::Uninstall,
            // 完了の要約テキストを生成する
            format!(
                "Verdaccio サービス '{}' のアンインストールが完了しました",
                service_name
            ),
        );

        // 正常終了を示す Ok(()) を返す
        Ok(())
    }

    // Verdaccio の現在の状態を返す
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

        // ポート番号を取得する
        let port = config.verdaccio.port;
        // 未インストール時は TCP プローブをスキップする（最大 2 秒の無駄な待ちを防ぐ）
        let endpoint_reachable = if service_status == crate::winsvc::ServiceStatus::NotInstalled {
            // サービスが存在しない場合はエンドポイントに到達できないと確定する
            false
        } else {
            // TCP 接続でエンドポイントの生死確認を行う
            TcpStream::connect_timeout(
                // 接続先アドレスを構築する
                &format!("127.0.0.1:{}", port)
                    .parse()
                    .unwrap_or_else(|_| "127.0.0.1:0".parse().unwrap()),
                // タイムアウトを 2 秒に設定する
                Duration::from_secs(2),
            )
            .is_ok()
        };

        // エンドポイント URL を構築する
        let endpoint_url = format!("http://127.0.0.1:{}/-/ping", port);
        // ブラウザで開く Web UI ルート URL を構築する
        let web_url = format!("http://127.0.0.1:{}/", port);
        // ストレージディレクトリの存在確認を行う
        let data_dir_exists = paths::verdaccio_storage_dir(config).exists();

        // ComponentStatus を構築して返す
        Ok(ComponentStatus {
            // Verdaccio コンポーネントを指定する
            component: Component::Verdaccio,
            // サービス名を格納する
            service_name,
            // サービスの状態を格納する
            service_status,
            // エンドポイント到達可否を格納する
            endpoint_reachable,
            // エンドポイント URL を格納する
            endpoint_url,
            // Web UI ルート URL を格納する
            web_url,
            // データディレクトリの存在確認結果を格納する
            data_dir_exists,
        })
    }
}
