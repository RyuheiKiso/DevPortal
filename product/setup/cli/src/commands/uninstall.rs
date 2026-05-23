// このファイルは uninstall サブコマンドの実装を提供する
// Verdaccio / Backstage / BaGet のサービスを削除してアンインストールする

// mpsc チャネルを使ってスレッド間でイベントを通信する
use std::sync::mpsc;

// UninstallArgs 型を参照するために使用する
use crate::args::UninstallArgs;

// Renderer 型を参照するために使用する
use crate::render::Renderer;

// SetupConfig 型を参照するために使用する
use shared::config::SetupConfig;

// エンジンファクトリ関数を参照するために使用する
use shared::engine::engine_for;

// Reporter と Component 型を参照するために使用する
use shared::event::{Component, Reporter, SetupEvent};

// 管理者権限確認と昇格再起動の関数を参照するために使用する
use shared::elevation::{is_elevated, run_self_elevated};

// 1 つのコンポーネントをアンインストールするヘルパー関数
// component: アンインストール対象のコンポーネント種別
// config: セットアップ設定の所有権を受け取る
// renderer: 出力形式を制御する Renderer への参照
// keep_data: データディレクトリを保持するかどうかのフラグ
fn uninstall_component(
    component: Component,
    config: SetupConfig,
    renderer: &Renderer,
    keep_data: bool,
) -> anyhow::Result<bool> {
    // mpsc チャネルを作成してイベントの送受信端を取得する
    let (tx, rx) = mpsc::channel::<SetupEvent>();

    // Reporter を送信端で初期化する
    let reporter = Reporter::new(tx);

    // エンジンを生成する（Box<dyn SetupEngine> を返す）
    let engine = engine_for(component);

    // 別スレッドでエンジンのアンインストールを実行する
    // config と reporter の所有権をスレッドに移動する
    let handle = std::thread::spawn(move || {
        // エンジンの uninstall メソッドを実行してアンインストール処理を行う
        engine.uninstall(&config, &reporter, keep_data)
    });

    // 失敗フラグを初期化する
    let mut failed = false;

    // メインスレッドでチャネルからイベントを受信してレンダリングする
    for event in rx {
        // Failed イベントを受け取ったらフラグを立てる
        if matches!(event, SetupEvent::Failed { .. }) {
            // 失敗フラグを立てる
            failed = true;
        }
        // 受信したイベントを renderer で表示する
        renderer.render(&event);
    }

    // スレッドが完了するまで待機してエラーを確認する
    match handle.join() {
        // スレッドが正常終了した場合はアンインストール結果を確認する
        Ok(Ok(())) => {}
        // エンジンの uninstall がエラーを返した場合は失敗とする
        Ok(Err(e)) => {
            // エラーメッセージを標準エラーに出力する
            eprintln!("アンインストールエラー: {}", e);
            // 失敗フラグを立てる
            failed = true;
        }
        // スレッドがパニックした場合も失敗とする
        Err(_) => {
            // パニックメッセージを出力する
            eprintln!("アンインストールスレッドがパニックしました");
            // 失敗フラグを立てる
            failed = true;
        }
    }

    // 失敗したかどうかを返す（true = 失敗）
    Ok(failed)
}

// uninstall コマンドのエントリポイント関数
// args: uninstall サブコマンドの引数
// config: セットアップ設定
// renderer: 出力形式（JSON または人間向け）を制御する Renderer への参照
// no_elevate: 昇格ループ防止フラグ（true のとき昇格再起動をスキップする）
pub fn run(
    args: &UninstallArgs,
    config: &SetupConfig,
    renderer: &Renderer,
    no_elevate: bool,
) -> anyhow::Result<()> {
    // 管理者権限を確認し、未昇格かつ --no-elevate 未指定の場合は昇格して再起動する
    if !is_elevated() && !no_elevate {
        // 昇格して再起動する際に渡す引数リストを構築する
        let mut elevated_args = vec![
            // uninstall サブコマンドを指定する
            "uninstall",
            // ターゲットを指定する
            args.target.as_str(),
            // 昇格ループ防止フラグを付与する
            "--no-elevate",
        ];

        // --keep-data フラグが指定されている場合は昇格後のコマンドにも追加する
        if args.keep_data {
            // データ保持フラグを追加する
            elevated_args.push("--keep-data");
        }

        // --force フラグが指定されている場合は昇格後のコマンドにも追加する
        if args.force {
            // 強制終了フラグを追加する
            elevated_args.push("--force");
        }

        // --yes フラグが指定されている場合は昇格後のコマンドにも追加する
        if args.yes {
            // 確認スキップフラグを追加する
            elevated_args.push("--yes");
        }

        // 管理者権限で自身を再起動する
        run_self_elevated(&elevated_args)?;
        // 昇格再起動が成功したら現在のプロセスは終了する
        return Ok(());
    }

    // config をクローンしてスレッドに渡すための設定を準備する
    let effective_config = config.clone();

    // keep_data フラグを引数から取得する
    let keep_data = args.keep_data;

    // target を小文字に正規化する
    let target = args.target.to_lowercase();

    // 全体の失敗フラグを初期化する
    let mut any_failed = false;

    // target の値に応じてアンインストール対象を決定する
    match target.as_str() {
        // target が "verdaccio" の場合は Verdaccio のみアンインストールする
        "verdaccio" => {
            // Verdaccio をアンインストールしてフラグを更新する
            let failed =
                uninstall_component(Component::Verdaccio, effective_config, renderer, keep_data)?;
            // 失敗フラグを更新する
            any_failed = any_failed || failed;
        }
        // target が "backstage" の場合は Backstage のみアンインストールする
        "backstage" => {
            // Backstage をアンインストールしてフラグを更新する
            let failed =
                uninstall_component(Component::Backstage, effective_config, renderer, keep_data)?;
            // 失敗フラグを更新する
            any_failed = any_failed || failed;
        }
        // target が "baget" の場合は BaGet のみアンインストールする
        "baget" => {
            // BaGet をアンインストールしてフラグを更新する
            let failed =
                uninstall_component(Component::BaGet, effective_config, renderer, keep_data)?;
            // 失敗フラグを更新する
            any_failed = any_failed || failed;
        }
        // target が "all" の場合は Verdaccio → Backstage → BaGet の順でアンインストールする
        "all" => {
            // Verdaccio を先にアンインストールする（config のクローンをスレッドに渡す）
            let verdaccio_config = effective_config.clone();
            // Verdaccio のアンインストールを実行する
            let failed_v =
                uninstall_component(Component::Verdaccio, verdaccio_config, renderer, keep_data)?;
            // 失敗フラグを更新する
            any_failed = any_failed || failed_v;

            // Backstage をその後にアンインストールする
            let backstage_config = effective_config.clone();
            // Backstage のアンインストールを実行する
            let failed_b =
                uninstall_component(Component::Backstage, backstage_config, renderer, keep_data)?;
            // 失敗フラグを更新する
            any_failed = any_failed || failed_b;

            // BaGet を最後にアンインストールする
            let baget_config = effective_config;
            // BaGet のアンインストールを実行する
            let failed_bg =
                uninstall_component(Component::BaGet, baget_config, renderer, keep_data)?;
            // 失敗フラグを更新する
            any_failed = any_failed || failed_bg;
        }
        // 未知の target が指定された場合はエラーを返す
        unknown => {
            // 不明なターゲット名を含むエラーメッセージを返す
            return Err(anyhow::anyhow!(
                "不明なターゲット: '{}'. 有効な値: verdaccio / backstage / baget / all",
                unknown
            ));
        }
    }

    // いずれかのコンポーネントが失敗した場合はプロセスを失敗終了コードで終了する
    if any_failed {
        // 終了コード 1 でプロセスを終了する
        std::process::exit(1);
    }

    // 全コンポーネントが正常にアンインストールされた場合は Ok(()) を返す
    Ok(())
}
