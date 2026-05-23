// このファイルは SetupEvent を人間向けまたは JSON 形式で出力する Renderer を定義する
// json_mode フラグによって出力形式を切り替える

// SetupEvent 型を参照するために使用する
use shared::event::SetupEvent;

// PrereqReport 型を参照するために使用する
use shared::prereq::PrereqReport;

// ComponentStatus 型を参照するために使用する
use shared::engine::ComponentStatus;

// Renderer: イベントを人間向けまたは JSON 形式で出力する構造体
pub struct Renderer {
    // true のとき JSON 1 行形式で出力し、false のとき人間向けテキストで出力する
    json_mode: bool,
}

// Renderer のメソッド実装ブロック
impl Renderer {
    // Renderer を新規作成する。json_mode フラグを受け取る
    pub fn new(json_mode: bool) -> Self {
        // json_mode フィールドを初期化して返す
        Self { json_mode }
    }

    // SetupEvent を受け取り、json_mode なら 1 行 JSON に出力し、
    // そうでなければ人間向けに ASCII シンボルで表示する
    pub fn render(&self, event: &SetupEvent) {
        // JSON モードの場合はイベントを JSON 文字列にシリアライズして出力する
        if self.json_mode {
            // serde_json でイベントを JSON 文字列に変換する（失敗時は空文字列）
            println!("{}", serde_json::to_string(event).unwrap_or_default());
            // JSON モードの場合は以降の人間向け表示は行わない
            return;
        }

        // イベントの種別に応じて人間向けの表示を行う
        match event {
            // ステップ開始イベントの表示
            SetupEvent::StepStart {
                label,
                index,
                total_steps,
                ..
            } => {
                // ステップ番号とラベルを表示する（">" は ASCII で表現する）
                println!("> [{}/{}] {}", index + 1, total_steps, label);
            }
            // ステップ完了イベントの表示
            SetupEvent::StepDone { id, duration_ms } => {
                // ステップ ID と経過時間を表示する
                println!("  Done [{}] ({}ms)", id, duration_ms);
            }
            // 進捗イベントの表示
            SetupEvent::Progress {
                id,
                percent,
                message,
            } => {
                // 進捗率と任意のメッセージを表示する
                if let Some(msg) = message {
                    // メッセージがある場合は一緒に表示する
                    println!("  [{}] {}% - {}", id, percent, msg);
                } else {
                    // メッセージがない場合は進捗率のみ表示する
                    println!("  [{}] {}%", id, percent);
                }
            }
            // 標準出力イベントの表示
            SetupEvent::Stdout { line, .. } => {
                // 外部コマンドの標準出力行を字下げして表示する
                println!("   > {}", line);
            }
            // 標準エラー出力イベントの表示
            SetupEvent::Stderr { line, .. } => {
                // 外部コマンドの標準エラー出力行を字下げして表示する
                println!("   > {}", line);
            }
            // 警告イベントの表示
            SetupEvent::Warn { message, .. } => {
                // 警告シンボル "!" と警告メッセージを表示する
                println!("! {}", message);
            }
            // 情報イベントの表示
            SetupEvent::Info { message } => {
                // 情報メッセージを字下げして表示する
                println!("  {}", message);
            }
            // 完了イベントの表示
            SetupEvent::Finished { summary, .. } => {
                // 完了シンボル "OK" と要約テキストを表示する
                println!("OK 完了: {}", summary);
            }
            // 失敗イベントの表示
            SetupEvent::Failed { error, .. } => {
                // 失敗シンボル "NG" とエラーメッセージを表示する
                println!("NG エラー: {}", error);
            }
        }
    }

    // PrereqReport を人間向け（またはJSON）で表示する
    pub fn render_prereq_report(&self, report: &PrereqReport) {
        // JSON モードの場合はレポート全体を JSON として出力する
        if self.json_mode {
            // PrereqReport を JSON 文字列にシリアライズして出力する（失敗時は空文字列）
            println!("{}", serde_json::to_string(report).unwrap_or_default());
            // JSON モードの場合は以降の人間向け表示は行わない
            return;
        }

        // 人間向けにヘッダーを表示する
        println!("--- 前提条件チェック結果 ---");

        // 各コマンドのチェック結果を表示する
        for item in &report.items {
            // コマンドが見つかった場合と見つからなかった場合で表示を分ける
            if item.found {
                // バージョン情報がある場合はバージョンも表示する
                if let Some(version) = &item.version {
                    // コマンド名、OK シンボル、バージョンを表示する
                    println!("  OK {} ({})", item.name, version);
                } else {
                    // バージョン情報がない場合はコマンド名のみ表示する
                    println!("  OK {}", item.name);
                }
            } else {
                // コマンドが見つからなかった場合は NG シンボルとインストール案内を表示する
                println!("  NG {} -- {}", item.name, item.install_hint);
            }
        }

        // 全コマンドが揃っているかどうかの総合判定を表示する
        if report.all_ok {
            // 全コマンドが見つかった場合は OK メッセージを表示する
            println!("--- 全前提条件を満たしています ---");
        } else {
            // 1 つ以上のコマンドが見つからなかった場合は NG メッセージを表示する
            println!("--- 不足している前提条件があります ---");
        }
    }

    // ComponentStatus を人間向け（またはJSON）で表示する
    pub fn render_component_status(&self, status: &ComponentStatus) {
        // JSON モードの場合はステータス全体を JSON として出力する
        if self.json_mode {
            // ComponentStatus を JSON 文字列にシリアライズして出力する（失敗時は空文字列）
            println!("{}", serde_json::to_string(status).unwrap_or_default());
            // JSON モードの場合は以降の人間向け表示は行わない
            return;
        }

        // コンポーネント名を文字列として取得する
        let component_name = format!("{:?}", status.component);

        // コンポーネント名とサービス名をヘッダーとして表示する
        println!("--- {} ({}) ---", component_name, status.service_name);

        // サービスの状態を表示する
        println!("  サービス状態: {:?}", status.service_status);

        // エンドポイントの到達可否を表示する
        if status.endpoint_reachable {
            // エンドポイントに到達できる場合は URL と合わせて表示する
            println!("  エンドポイント: OK ({})", status.endpoint_url);
        } else {
            // エンドポイントに到達できない場合は NG と URL を表示する
            println!("  エンドポイント: NG ({})", status.endpoint_url);
        }
        // Web UI URL を表示する（ブラウザでアクセスする際の入口）
        println!("  Web UI: {}", status.web_url);

        // データディレクトリの存在確認結果を表示する
        if status.data_dir_exists {
            // データディレクトリが存在する場合は OK を表示する
            println!("  データディレクトリ: 存在する");
        } else {
            // データディレクトリが存在しない場合は NG を表示する
            println!("  データディレクトリ: 存在しない");
        }
    }
}
