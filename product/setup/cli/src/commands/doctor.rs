// このファイルは doctor サブコマンドの実装を提供する
// 前提コマンド（node/npm/npx/yarn/git）の存在確認を実行してレポートを表示する

// Renderer 型を参照するために使用する
use crate::render::Renderer;

// doctor コマンドのエントリポイント関数
// renderer: 出力形式（JSON または人間向け）を制御する Renderer への参照
pub fn run(renderer: &Renderer) -> anyhow::Result<()> {
    // shared::prereq::check_prereqs() を呼び出して前提条件チェックを実行する
    let report = shared::prereq::check_prereqs();

    // チェック結果を renderer 経由で表示する
    renderer.render_prereq_report(&report);

    // 全コマンドが見つからなかった場合は終了コード 1 で終了する
    if !report.all_ok {
        // 前提条件が不足している場合はプロセスを失敗終了コードで終了する
        std::process::exit(1);
    }

    // 全コマンドが見つかった場合は正常終了する
    Ok(())
}
