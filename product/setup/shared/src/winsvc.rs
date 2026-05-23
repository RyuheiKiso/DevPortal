// このファイルは Windows サービスの状態を sc.exe コマンドで確認する機能を提供する
// sc.exe の出力をパースして ServiceStatus 列挙型に変換する

// 外部コマンド実行に必要な型をインポートする
use std::process::{Command, Stdio};

// ServiceStatus: Windows サービスの実行状態を表す列挙型
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
// JSON シリアライズ時に snake_case のキーを使用する
#[serde(rename_all = "snake_case")]
pub enum ServiceStatus {
    // サービスが正常に実行中の状態
    Running,
    // サービスが停止している状態
    Stopped,
    // サービスが一時停止している状態
    Paused,
    // 開始中・停止中などの遷移状態（Pending）
    Pending,
    // サービスがインストールされていない状態
    NotInstalled,
    // 状態が不明または取得できなかった状態
    Unknown,
}

// sc.exe query <service_name> を実行してサービスの状態を取得する関数
// 状態コード: 1=Stopped, 2-3=Pending, 4=Running, 5-7=その他Pending, STATE行なし=NotInstalled, エラー=Unknown
pub fn query_service_status(service_name: &str) -> ServiceStatus {
    // sc.exe コマンドを使ってサービスの状態を問い合わせる
    let output = Command::new("sc.exe")
        // query サブコマンドでサービス情報を取得する
        .arg("query")
        // 状態を確認するサービス名を指定する
        .arg(service_name)
        // 標準出力をキャプチャする
        .stdout(Stdio::piped())
        // 標準エラーを捨てる（エラーは戻り値で判断する）
        .stderr(Stdio::null())
        // コマンドを実行して出力を待つ
        .output();

    // コマンド実行結果を確認する
    let output = match output {
        // 実行に成功した場合は出力を使用する
        Ok(o) => o,
        // コマンド実行自体が失敗した場合は Unknown を返す
        Err(_) => return ServiceStatus::Unknown,
    };

    // 標準出力を UTF-8 文字列に変換する
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // sc.exe の出力を行単位でパースしてサービス状態を解析する
    // sc.exe がサービスを見つけられない場合は終了コードが 0 以外になる
    if !output.status.success() {
        // サービスが見つからない場合（終了コードが 0 以外）は NotInstalled を返す
        // ただし "FAILED 1060" などの場合は NotInstalled として扱う
        if stdout.contains("FAILED 1060")
            || stdout.contains("指定されたサービスはインストールされていません")
            || output.stdout.is_empty()
        {
            // サービスがインストールされていない状態を返す
            return ServiceStatus::NotInstalled;
        }
        // その他のエラーは Unknown として扱う
        return ServiceStatus::Unknown;
    }

    // 出力の各行を検索して STATE 行を見つける
    for line in stdout.lines() {
        // STATE を含む行を探す（例: "        STATE              : 4  RUNNING"）
        let trimmed = line.trim();
        // STATE フィールドを含む行かどうかを確認する
        if trimmed.starts_with("STATE") {
            // コロン以降の部分を取得する
            if let Some(after_colon) = trimmed.split(':').nth(1) {
                // コロン以降の文字列を空白でトリムする
                let value_part = after_colon.trim();
                // 最初のトークン（数値）を取得する
                if let Some(code_str) = value_part.split_whitespace().next() {
                    // 数値文字列を u32 にパースする
                    if let Ok(code) = code_str.parse::<u32>() {
                        // 状態コードに対応する ServiceStatus を返す
                        return match code {
                            // 状態コード 1: サービスが停止している
                            1 => ServiceStatus::Stopped,
                            // 状態コード 2-3: サービスが遷移中（開始中・停止中）
                            2 | 3 => ServiceStatus::Pending,
                            // 状態コード 4: サービスが実行中
                            4 => ServiceStatus::Running,
                            // 状態コード 5: サービスが停止継続中（遷移状態）
                            5 => ServiceStatus::Pending,
                            // 状態コード 6: サービスが一時停止中
                            6 => ServiceStatus::Paused,
                            // 状態コード 7: サービスが一時停止から再開中（遷移状態）
                            7 => ServiceStatus::Pending,
                            // 未知の状態コードは Unknown として扱う
                            _ => ServiceStatus::Unknown,
                        };
                    }
                }
            }
        }
    }

    // STATE 行が見つからなかった場合はサービスがインストールされていないと判断する
    // ただし出力が空でない場合は何らかの情報があるため Unknown を返す
    if stdout.is_empty() {
        // 出力が完全に空の場合は NotInstalled を返す
        ServiceStatus::NotInstalled
    } else {
        // STATE 行が見つからないが出力がある場合は Unknown を返す
        ServiceStatus::Unknown
    }
}
