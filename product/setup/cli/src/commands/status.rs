// このファイルは status サブコマンドの実装を提供する
// 指定されたコンポーネント（またはすべて）の状態を取得して表示する

// StatusArgs 型を参照するために使用する
use crate::args::StatusArgs;

// Renderer 型を参照するために使用する
use crate::render::Renderer;

// SetupConfig 型を参照するために使用する
use shared::config::SetupConfig;

// エンジンファクトリ関数を参照するために使用する
use shared::engine::engine_for;

// Component 列挙型を参照するために使用する
use shared::event::Component;

// status コマンドのエントリポイント関数
// args: status サブコマンドの引数
// config: セットアップ設定（サービス名やポートの解決に使用）
// renderer: 出力形式（JSON または人間向け）を制御する Renderer への参照
pub fn run(args: &StatusArgs, config: &SetupConfig, renderer: &Renderer) -> anyhow::Result<()> {
    // target 引数を小文字に正規化して比較しやすくする
    let target = args
        .target
        .as_deref()
        // target が Some のとき小文字に変換する
        .map(|s| s.to_lowercase());

    // target の値に応じて確認対象のコンポーネントを決定する
    match target.as_deref() {
        // target が "verdaccio" の場合は Verdaccio のみ確認する
        Some("verdaccio") => {
            // VerdaccioEngine を使って Verdaccio の状態を取得する
            let engine = engine_for(Component::Verdaccio);
            // status メソッドを呼び出して ComponentStatus を取得する
            let status = engine.status(config)?;
            // 取得した状態を renderer で表示する
            renderer.render_component_status(&status);
        }
        // target が "backstage" の場合は Backstage のみ確認する
        Some("backstage") => {
            // BackstageEngine を使って Backstage の状態を取得する
            let engine = engine_for(Component::Backstage);
            // status メソッドを呼び出して ComponentStatus を取得する
            let status = engine.status(config)?;
            // 取得した状態を renderer で表示する
            renderer.render_component_status(&status);
        }
        // target が None（省略）または "all" の場合は両方確認する
        None | Some("all") => {
            // VerdaccioEngine を使って Verdaccio の状態を取得する
            let verdaccio_engine = engine_for(Component::Verdaccio);
            // Verdaccio の status を取得する
            let verdaccio_status = verdaccio_engine.status(config)?;
            // Verdaccio の状態を renderer で表示する
            renderer.render_component_status(&verdaccio_status);

            // BackstageEngine を使って Backstage の状態を取得する
            let backstage_engine = engine_for(Component::Backstage);
            // Backstage の status を取得する
            let backstage_status = backstage_engine.status(config)?;
            // Backstage の状態を renderer で表示する
            renderer.render_component_status(&backstage_status);
        }
        // 未知の target が指定された場合はエラーを返す
        Some(unknown) => {
            // 不明なターゲット名を含むエラーメッセージを返す
            return Err(anyhow::anyhow!(
                "不明なターゲット: '{}'. 有効な値: verdaccio / backstage / all",
                unknown
            ));
        }
    }

    // 正常終了を示す Ok(()) を返す
    Ok(())
}
