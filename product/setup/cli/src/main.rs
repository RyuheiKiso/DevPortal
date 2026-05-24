// main.rs: CLI のエントリポイント。clap でコマンドをパースし各サブコマンドに委譲する

// clap の Parser トレイトを取り込む（Cli 構造体の parse() メソッドに必要）
use clap::Parser;

// CLI 引数構造体と列挙型を定義するモジュール
mod args;

// イベントレンダリング（JSON / 人間向けテキスト出力）を定義するモジュール
mod render;

// 各サブコマンドの実装をまとめるモジュール
mod commands;

// Cli 構造体と Commands 列挙型を取り込む
use args::{Cli, Commands};

// Renderer 構造体を取り込む
use render::Renderer;

// SetupConfig 構造体を取り込む
use shared::config::SetupConfig;
use shared::error::SetupError;

fn load_config_or_default(config_path: &std::path::PathBuf) -> Result<SetupConfig, SetupError> {
    match SetupConfig::from_file(config_path) {
        Ok(config) => Ok(config),
        Err(SetupError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(SetupConfig::default())
        }
        Err(e) => Err(e),
    }
}

// バイナリのエントリポイント
fn main() {
    // clap でコマンドライン引数をパースする
    let cli = Cli::parse();

    // json フラグに基づいて Renderer を作成する
    let renderer = Renderer::new(cli.json);

    // 設定ファイルのパスを決定する（--config で指定されていなければデフォルトパスを使う）
    let config_path = cli
        .config
        .clone()
        .unwrap_or_else(shared::paths::config_file);

    // 設定ファイルを読み込む（ファイルがなければデフォルト値を使う）
    let mut config = match load_config_or_default(&config_path) {
        Ok(config) => config,
        Err(e) => {
            eprintln!("設定ファイルの読み込みに失敗しました: {e}");
            std::process::exit(1);
        }
    };
    let config_override = cli.config.as_ref().map(|path| {
        if path.is_absolute() {
            path.clone()
        } else {
            std::env::current_dir()
                .map(|cwd| cwd.join(path))
                .unwrap_or_else(|_| path.clone())
        }
    });
    let config_override = config_override.as_deref();

    // サブコマンドを実行する（各コマンドの run 関数に委譲する）
    let result = match &cli.command {
        // doctor: 前提条件チェックのみ実行する
        Commands::Doctor => commands::doctor::run(&renderer),

        // status: コンポーネントの状態を表示する
        Commands::Status(args) => commands::status::run(args, &config, &renderer),

        // install: コンポーネントをインストールする（昇格フラグを渡す）
        Commands::Install(args) => {
            // install コマンドに昇格ループ防止フラグを渡す
            commands::install::run(
                args,
                &config,
                &renderer,
                cli.no_elevate,
                cli.json,
                config_override,
            )
        }

        // uninstall: コンポーネントをアンインストールする（昇格フラグを渡す）
        Commands::Uninstall(args) => {
            // uninstall コマンドに昇格ループ防止フラグを渡す
            commands::uninstall::run(
                args,
                &config,
                &renderer,
                cli.no_elevate,
                cli.json,
                config_override,
            )
        }

        // service: Windows サービスを制御する（昇格フラグを渡す）
        Commands::Service(args) => {
            // service コマンドに昇格ループ防止フラグを渡す
            commands::service::run(
                args,
                &config,
                &renderer,
                cli.no_elevate,
                cli.json,
                config_override,
            )
        }

        // config: セットアップ設定の表示・変更を行う（可変参照を渡す）
        Commands::Config(args) => commands::config_cmd::run(args, &mut config, &config_path),
    };

    // エラーがあれば標準エラーに表示して終了コード 1 で終了する
    if let Err(e) = result {
        // エラーメッセージを標準エラー出力に表示する
        eprintln!("エラー: {e}");
        // 終了コード 1 でプロセスを終了する
        std::process::exit(1);
    }
}
