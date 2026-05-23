// このファイルは service サブコマンドの実装を提供する
// Windows サービスの起動・停止・再起動・ログ表示を行う

// ファイルシステム操作に必要な型をインポートする
use std::fs;

// ファイル読み込みに必要なトレイトをインポートする
use std::io::{BufRead, BufReader};

// ServiceArgs と ServiceAction 型を参照するために使用する
use crate::args::{ServiceAction, ServiceArgs};

// Renderer 型を参照するために使用する
use crate::render::Renderer;

// SetupConfig 型を参照するために使用する
use shared::config::SetupConfig;

// Reporter と SetupEvent を参照するために使用する（NSSM ダウンロード進捗表示用）
use shared::event::{Reporter, SetupEvent};

// エンジンファクトリ関数を参照するために使用する
use shared::engine::engine_for;

// Component 列挙型を参照するために使用する
use shared::event::Component;

// Nssm ラッパ構造体を参照するために使用する
use shared::nssm::Nssm;

// パス解決関数を参照するために使用する
use shared::paths;

// 管理者権限確認と昇格再起動の関数を参照するために使用する
use shared::elevation::{is_elevated, run_self_elevated};

// target 文字列を Component に変換するヘルパー関数
// "verdaccio" → Component::Verdaccio、"backstage" → Component::Backstage、"baget" → Component::BaGet
fn parse_component(target: &str) -> anyhow::Result<Component> {
    // target を小文字に正規化してマッチングする
    match target.to_lowercase().as_str() {
        // "verdaccio" の場合は Verdaccio コンポーネントを返す
        "verdaccio" => Ok(Component::Verdaccio),
        // "backstage" の場合は Backstage コンポーネントを返す
        "backstage" => Ok(Component::Backstage),
        // "baget" の場合は BaGet コンポーネントを返す
        "baget" => Ok(Component::BaGet),
        // 未知の値の場合はエラーを返す
        _ => Err(anyhow::anyhow!(
            "不明なターゲット: '{}'. 有効な値: verdaccio / backstage / baget",
            target
        )),
    }
}

// service コマンドのエントリポイント関数
// args: service サブコマンドの引数（操作種別と対象コンポーネントを含む）
// config: セットアップ設定（サービス名の解決に使用）
// _renderer: 出力形式（JSON または人間向け）を制御する Renderer への参照（現在は未使用）
// no_elevate: 昇格ループ防止フラグ（true のとき昇格再起動をスキップする）
pub fn run(
    args: &ServiceArgs,
    config: &SetupConfig,
    _renderer: &Renderer,
    no_elevate: bool,
) -> anyhow::Result<()> {
    // logs コマンドのみ管理者権限不要のため、操作種別を先に確認する
    match &args.action {
        // logs コマンドの場合はログファイルを読み込んで表示する
        ServiceAction::Logs { target, tail } => {
            // target を Component に変換する
            let component = parse_component(target)?;

            // コンポーネントに応じてログディレクトリを決定する
            let logs_dir = match component {
                // Verdaccio の場合は verdaccio のログディレクトリを取得する
                Component::Verdaccio => paths::verdaccio_logs_dir(config),
                // Backstage の場合は backstage のログディレクトリを取得する
                Component::Backstage => paths::backstage_logs_dir(config),
                // BaGet の場合は baget のログディレクトリを取得する
                Component::BaGet => paths::baget_logs_dir(config),
            };

            // stdout.log ファイルのパスを構築する
            let log_file = logs_dir.join("stdout.log");

            // ログファイルが存在するか確認する
            if !log_file.exists() {
                // ログファイルが存在しない場合はエラーメッセージを表示して終了する
                println!("ログファイルが見つかりません: {}", log_file.display());
                // 正常終了する（ログがないのはエラーではない）
                return Ok(());
            }

            // ログファイルを開く
            let file = fs::File::open(&log_file)
                .map_err(|e| anyhow::anyhow!("ログファイルを開けませんでした: {}", e))?;

            // バッファリングしてファイルを行単位で読み込む
            let reader = BufReader::new(file);

            // 全行をベクタに収集する
            let lines: Vec<String> = reader
                .lines()
                // 読み込みエラーをスキップする
                .filter_map(|l| l.ok())
                // 全行をベクタに収集する
                .collect();

            // 末尾から tail 行分を取得する
            let start = if lines.len() > *tail {
                // tail 行より多い場合は末尾 tail 行のみ表示する
                lines.len() - tail
            } else {
                // tail 行以下の場合は全行表示する
                0
            };

            // 対象行を標準出力に表示する
            for line in &lines[start..] {
                // 各行を表示する
                println!("{}", line);
            }

            // logs コマンドは管理者権限不要のため昇格チェックをスキップして終了する
            return Ok(());
        }
        // その他のコマンド（start/stop/restart）は管理者権限チェックを行う
        _ => {}
    }

    // start/stop/restart コマンドは管理者権限が必要なため確認する
    if !is_elevated() && !no_elevate {
        // 昇格して再起動する際に渡す引数リストを構築する
        let (action_name, target_name) = match &args.action {
            // start コマンドの引数を準備する
            ServiceAction::Start { target } => ("start", target.as_str()),
            // stop コマンドの引数を準備する
            ServiceAction::Stop { target } => ("stop", target.as_str()),
            // restart コマンドの引数を準備する
            ServiceAction::Restart { target } => ("restart", target.as_str()),
            // logs は上で処理済みのため到達しない
            ServiceAction::Logs { .. } => unreachable!(),
        };

        // 昇格引数リストを構築する
        let elevated_args = vec![
            // service サブコマンドを指定する
            "service",
            // 操作種別（start/stop/restart）を指定する
            action_name,
            // ターゲット（verdaccio/backstage）を指定する
            target_name,
            // 昇格ループ防止フラグを付与する
            "--no-elevate",
        ];

        // 管理者権限で自身を再起動する
        run_self_elevated(&elevated_args)?;
        // 昇格再起動が成功したら現在のプロセスは終了する
        return Ok(());
    }

    // NSSM を確保するための一時チャネルを作成する
    // service コマンドには Reporter が渡されないため、ここでダミーチャネルを作成する
    let (tx, rx) = std::sync::mpsc::channel::<SetupEvent>();
    // Reporter インスタンスを作成する
    let reporter = Reporter::new(tx);

    // NSSM インスタンスを確保する（キャッシュがあれば即時、なければ HTTP 動的取得）
    // NSSM ダウンロード進捗を受信スレッドで Renderer に渡す
    let nssm_result = {
        // NSSM 取得を別スレッドで実行する（reporter と同じスレッドでは recv できないため）
        let reporter_ref = reporter;
        // メインスレッドで NSSM を確保する
        Nssm::ensure(&reporter_ref)
            .map_err(|e| anyhow::anyhow!("NSSM の初期化に失敗しました: {}", e))?
    };

    // 受信チャネルのイベントを Renderer で表示する（既に受信可能なイベントがあれば処理）
    // try_recv でノンブロッキングに受信する
    while let Ok(event) = rx.try_recv() {
        // Renderer でイベントを表示する
        _renderer.render(&event);
    }

    // 確保した NSSM インスタンスを使用する
    let nssm = nssm_result;

    // 操作種別に応じて対応する NSSM コマンドを実行する
    match &args.action {
        // start コマンドの処理
        ServiceAction::Start { target } => {
            // target を Component に変換する
            let component = parse_component(target)?;
            // エンジンを生成してサービス名を取得する
            let engine = engine_for(component);
            // サービス名を取得する
            let service_name = engine.service_name(config);
            // NSSM でサービスを起動する
            nssm.start(&service_name)
                .map_err(|e| anyhow::anyhow!("サービス起動に失敗しました: {}", e))?;
            // 起動成功メッセージを表示する
            println!("サービス '{}' を起動しました", service_name);
        }
        // stop コマンドの処理
        ServiceAction::Stop { target } => {
            // target を Component に変換する
            let component = parse_component(target)?;
            // エンジンを生成してサービス名を取得する
            let engine = engine_for(component);
            // サービス名を取得する
            let service_name = engine.service_name(config);
            // NSSM でサービスを停止する
            nssm.stop(&service_name)
                .map_err(|e| anyhow::anyhow!("サービス停止に失敗しました: {}", e))?;
            // 停止成功メッセージを表示する
            println!("サービス '{}' を停止しました", service_name);
        }
        // restart コマンドの処理
        ServiceAction::Restart { target } => {
            // target を Component に変換する
            let component = parse_component(target)?;
            // エンジンを生成してサービス名を取得する
            let engine = engine_for(component);
            // サービス名を取得する
            let service_name = engine.service_name(config);
            // まず NSSM でサービスを停止する（失敗しても続行する）
            let _ = nssm.stop(&service_name);
            // 次に NSSM でサービスを起動する
            nssm.start(&service_name)
                .map_err(|e| anyhow::anyhow!("サービス再起動に失敗しました: {}", e))?;
            // 再起動成功メッセージを表示する
            println!("サービス '{}' を再起動しました", service_name);
        }
        // logs は上で処理済みのため到達しない
        ServiceAction::Logs { .. } => unreachable!(),
    }

    // 正常終了を示す Ok(()) を返す
    Ok(())
}
