// このファイルはインストールを開始し進捗を Channel で送信する Tauri コマンドを定義する
// component 文字列と SetupConfig を受け取り、エンジンの install を別スレッドで実行する

// 標準ライブラリの mpsc チャネルをインポートする
use std::sync::mpsc;

// shared クレートのコンポーネント種別と操作種別をインポートする
use shared::event::{ActionKind, Component, Reporter, SetupEvent};
// shared クレートのエンジンファクトリ関数をインポートする
use shared::engine::engine_for;
// shared クレートの設定構造体をインポートする
use shared::config::SetupConfig;
// cmd_install: インストールを開始し進捗を Channel で送信する Tauri コマンド
// component: "verdaccio" または "backstage" を指定する文字列
// config: インストール設定（フロントエンドから JSON でシリアライズされて渡される）
// on_event: Tauri v2 の Channel<SetupEvent>（進捗イベントの送信先）
// 注: 管理者権限は app.manifest の requireAdministrator で OS レベルで保証される
// async にすることで Tauri の非同期ランタイム上で実行し、メインスレッドをブロックしない
#[tauri::command]
pub async fn cmd_install(
    // インストール対象のコンポーネント名文字列
    component: String,
    // インストール設定をフロントエンドから受け取る
    config: SetupConfig,
    // Tauri v2 の Channel 型（フロントエンドへのイベント送信に使用）
    on_event: tauri::ipc::Channel<SetupEvent>,
) -> Result<(), String> {
    // component 文字列を Component 列挙型に変換する
    let comp = match component.as_str() {
        // "verdaccio" を Component::Verdaccio に変換する
        "verdaccio" => Component::Verdaccio,
        // "backstage" を Component::Backstage に変換する
        "backstage" => Component::Backstage,
        // "baget" を Component::BaGet に変換する
        "baget" => Component::BaGet,
        // 未知のコンポーネント名の場合はエラーを返す
        other => return Err(format!("未知のコンポーネント: {}", other)),
    };

    // ブロッキング処理（mpsc 受信ループ）を専用スレッドで実行して非同期ランタイムを解放する
    // spawn_blocking を使わないと for event in rx がメインスレッドを占有しウィンドウが応答なしになる
    tauri::async_runtime::spawn_blocking(move || {
        // メインスレッドとワーカースレッド間でイベントを受け渡す mpsc チャネルを作成する
        let (tx, rx) = mpsc::channel::<SetupEvent>();

        // Reporter を作成する（送信端を渡してイベントを Reporter 経由で送信する）
        let reporter = Reporter::new(tx);

        // インストールエンジンを取得する（comp を clone して engine_for に渡し、元の値はエラー報告用に保持する）
        let engine = engine_for(comp.clone());

        // 別スレッドでエンジンの install を実行する（JoinHandle を保持して panic を検知する）
        let handle = std::thread::spawn(move || {
            // エンジンの install メソッドを呼び出してインストールを実行する
            if let Err(e) = engine.install(&config, &reporter) {
                // エンジンが reporter.failed() を呼ばずに Err を返した場合のフォールバック
                // （例: NSSM ダウンロード失敗など途中のエラーが ? で伝播した場合）
                reporter.failed(
                    // 対象コンポーネントを渡す
                    comp,
                    // インストール操作であることを示す
                    ActionKind::Install,
                    // エラー内容をそのまま渡す
                    e.to_string(),
                    // 回復可能でないエラーとして通知する
                    false,
                );
            }
        });

        // 受信ループでイベントを Channel 経由でフロントエンドに送信する
        let mut failed = false;
        // recv() でチャネルからイベントを受信し、送信端が Drop されるまでループする
        for event in rx {
            // Failed イベントが来た場合はフラグを立てる
            if let SetupEvent::Failed { .. } = &event {
                // インストール失敗フラグをセットする
                failed = true;
            }
            // on_event.send() でフロントエンドの Channel にイベントを送信する
            // 送信失敗は無視する（フロントエンドが切断している場合など）
            let _ = on_event.send(event);
        }

        // スレッドの終了を待ち、panic が発生した場合は Err を返す
        // join() が Err を返すのはスレッドが panic した場合のみ
        if handle.join().is_err() {
            // panic 時は false success を避けるためエラーを返す
            return Err("インストール中に予期しないエラーが発生しました".to_string());
        }

        // Failed イベントが来た場合はエラーを返す
        if failed {
            // インストールが失敗したことをフロントエンドに通知する
            Err("インストールに失敗しました".to_string())
        } else {
            // インストールが正常に完了したことを示す Ok(()) を返す
            Ok(())
        }
    })
    // spawn_blocking の JoinError を String に変換する
    .await
    .map_err(|e| e.to_string())?
}
