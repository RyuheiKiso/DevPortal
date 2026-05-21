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
