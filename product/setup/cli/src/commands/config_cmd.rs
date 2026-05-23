// このファイルは config サブコマンドの実装を提供する
// セットアップ設定の表示（show）と変更（set）を行う

// ConfigArgs と ConfigAction 型を参照するために使用する
use crate::args::{ConfigAction, ConfigArgs};

// SetupConfig 型と BackstageMode 型を参照するために使用する
use shared::config::{BackstageMode, SetupConfig};

// true/false 系の文字列を bool に変換するヘルパー関数
fn parse_bool(value: &str) -> anyhow::Result<bool> {
    match value.to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        _ => Err(anyhow::anyhow!(
            "真偽値は true/false, yes/no, on/off, 1/0 のいずれかで指定してください: {}",
            value
        )),
    }
}

// config コマンドのエントリポイント関数
// args: config サブコマンドの引数（show または set 操作を含む）
// config: セットアップ設定への可変参照（set 操作で変更するため可変参照を受け取る）
pub fn run(args: &ConfigArgs, config: &mut SetupConfig) -> anyhow::Result<()> {
    // 操作種別に応じた処理を実行する
    match &args.action {
        // show: 現在の設定を JSON 形式で表示する
        ConfigAction::Show => {
            // SetupConfig を JSON 文字列にシリアライズする
            let json = serde_json::to_string_pretty(config)
                .map_err(|e| anyhow::anyhow!("設定の JSON 変換に失敗しました: {}", e))?;
            // JSON 形式で設定を表示する
            println!("{}", json);
        }
        // set: 指定されたキーと値で設定を変更してファイルに保存する
        ConfigAction::Set { key, value } => {
            // キーを "." で分割してドット記法のキーパスを解析する
            // 対応キー: verdaccio.port / backstage.* / baget.* / install_root
            match key.as_str() {
                // Verdaccio のポート番号を変更する
                "verdaccio.port" => {
                    // 値を u16 にパースする
                    let port = value.parse::<u16>().map_err(|_| {
                        anyhow::anyhow!("ポート番号は 0〜65535 の整数で指定してください: {}", value)
                    })?;
                    // 設定のポート番号を更新する
                    config.verdaccio.port = port;
                    // 変更内容を表示する
                    println!("verdaccio.port を {} に設定しました", port);
                }
                // Backstage フロントエンドのポート番号を変更する
                "backstage.frontend_port" => {
                    // 値を u16 にパースする
                    let port = value.parse::<u16>().map_err(|_| {
                        anyhow::anyhow!("ポート番号は 0〜65535 の整数で指定してください: {}", value)
                    })?;
                    // 設定のフロントエンドポート番号を更新する
                    config.backstage.frontend_port = port;
                    // 変更内容を表示する
                    println!("backstage.frontend_port を {} に設定しました", port);
                }
                // Backstage バックエンドのポート番号を変更する
                "backstage.backend_port" => {
                    // 値を u16 にパースする
                    let port = value.parse::<u16>().map_err(|_| {
                        anyhow::anyhow!("ポート番号は 0〜65535 の整数で指定してください: {}", value)
                    })?;
                    // 設定のバックエンドポート番号を更新する
                    config.backstage.backend_port = port;
                    // 変更内容を表示する
                    println!("backstage.backend_port を {} に設定しました", port);
                }
                // Backstage の起動モードを変更する
                "backstage.mode" => {
                    // 値を BackstageMode に変換する
                    let mode = match value.to_ascii_lowercase().as_str() {
                        "dev" => BackstageMode::Dev,
                        "build" => BackstageMode::Build,
                        _ => {
                            return Err(anyhow::anyhow!(
                                "backstage.mode は dev または build を指定してください: {}",
                                value
                            ));
                        }
                    };
                    // 設定の起動モードを更新する
                    config.backstage.mode = mode;
                    // 変更内容を表示する
                    println!("backstage.mode を {} に設定しました", value);
                }
                // BaGet のポート番号を変更する
                "baget.port" => {
                    // 値を u16 にパースする
                    let port = value.parse::<u16>().map_err(|_| {
                        anyhow::anyhow!("ポート番号は 0〜65535 の整数で指定してください: {}", value)
                    })?;
                    // 設定のポート番号を更新する
                    config.baget.port = port;
                    // 変更内容を表示する
                    println!("baget.port を {} に設定しました", port);
                }
                // BaGet のバージョン指定を変更する
                "baget.version" => {
                    // 空文字は無効とする
                    if value.trim().is_empty() {
                        return Err(anyhow::anyhow!("baget.version は空にできません"));
                    }
                    // 設定のバージョン指定を更新する
                    config.baget.version = value.clone();
                    // 変更内容を表示する
                    println!("baget.version を {} に設定しました", value);
                }
                // BaGet のアンインストール時データ保持設定を変更する
                "baget.keep_data_on_uninstall" => {
                    // 値を bool にパースする
                    let keep_data = parse_bool(value)?;
                    // 設定のデータ保持フラグを更新する
                    config.baget.keep_data_on_uninstall = keep_data;
                    // 変更内容を表示する
                    println!(
                        "baget.keep_data_on_uninstall を {} に設定しました",
                        keep_data
                    );
                }
                // インストール先のルートディレクトリを変更する
                "install_root" => {
                    // 値を PathBuf に変換する
                    let path = std::path::PathBuf::from(value);
                    // 設定のインストールルートを更新する
                    config.install_root = Some(path.clone());
                    // 変更内容を表示する
                    println!("install_root を {} に設定しました", path.display());
                }
                // 未知のキーが指定された場合はエラーを返す
                unknown_key => {
                    // 不明なキー名を含むエラーメッセージを返す
                    return Err(anyhow::anyhow!(
                        "不明なキー: '{}'. 対応キー: verdaccio.port / backstage.frontend_port / backstage.backend_port / backstage.mode / baget.port / baget.version / baget.keep_data_on_uninstall / install_root",
                        unknown_key
                    ));
                }
            }

            // 変更した設定をファイルに保存する
            // 設定ファイルのデフォルトパスを取得する
            let config_path = shared::paths::config_file();

            // 設定をファイルに書き込む
            config
                .save_to(&config_path)
                .map_err(|e| anyhow::anyhow!("設定ファイルの保存に失敗しました: {}", e))?;

            // 保存完了メッセージを表示する
            println!("設定を {} に保存しました", config_path.display());
        }
    }

    // 正常終了を示す Ok(()) を返す
    Ok(())
}
