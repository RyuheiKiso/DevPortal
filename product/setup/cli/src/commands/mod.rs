// このファイルは commands ディレクトリ内のすべてのサブモジュールを公開する
// main.rs から各サブコマンドの実装をインポートするために使用する

// doctor コマンドの実装モジュール
pub mod doctor;

// status コマンドの実装モジュール
pub mod status;

// install コマンドの実装モジュール
pub mod install;

// uninstall コマンドの実装モジュール
pub mod uninstall;

// service コマンドの実装モジュール
pub mod service;

// config コマンドの実装モジュール（config は Rust のキーワードではないが命名の明確さのために _cmd サフィックスを付ける）
pub mod config_cmd;

pub fn elevated_args(
    json: bool,
    config_path: Option<&std::path::Path>,
    command_args: &[String],
) -> Vec<String> {
    let mut args = Vec::new();

    if json {
        args.push("--json".to_string());
    }

    if let Some(path) = config_path {
        args.push("--config".to_string());
        args.push(path.to_string_lossy().to_string());
    }

    args.push("--no-elevate".to_string());
    args.extend(command_args.iter().cloned());
    args
}

pub fn run_self_elevated_owned(args: Vec<String>) -> anyhow::Result<()> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    shared::elevation::run_self_elevated(&refs)?;
    Ok(())
}
