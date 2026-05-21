// このファイルはセットアップ前提条件（必須コマンド）の確認ロジックを定義する
// node / npm / npx / yarn / git の 5 コマンドが PATH 経由で実行可能かチェックする

// 外部コマンドを起動するために使用する
use std::process::Command;

// Windows の .cmd シム（npm.cmd, npx.cmd, yarn.cmd 等）に対応した build_command ヘルパーを参照する
use crate::process::build_command;

// PrereqItem: 1 つの前提コマンドのチェック結果を表す構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrereqItem {
    // チェック対象コマンドの名前（例: "node"）
    pub name: String,
    // コマンドが PATH 経由で実行可能かどうか
    pub found: bool,
    // コマンドが見つかった場合の実行ファイルパス文字列（取得できない場合は None）
    pub path: Option<String>,
    // `cmd --version` の出力の 1 行目（取得できない場合は None）
    pub version: Option<String>,
    // コマンドが見つからなかった場合にユーザーに表示するインストール案内文
    pub install_hint: String,
}

// PrereqReport: 全コマンドのチェック結果をまとめた構造体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrereqReport {
    // 各コマンドのチェック結果リスト
    pub items: Vec<PrereqItem>,
    // 全コマンドが見つかった場合に true、1 つでも欠けている場合は false
    pub all_ok: bool,
}

// 1 つのコマンドを `cmd --version` で実行して PrereqItem を構築するヘルパー関数
fn check_single(name: &str, install_hint: &str) -> PrereqItem {
    // `cmd --version` を実行してバージョン情報を取得する
    // build_command を使うことで Windows の .cmd シム（npm.cmd, npx.cmd, yarn.cmd 等）にも対応する
    // Command::new(name) の直呼び出しは .exe のみ探索するため .cmd は起動できない
    let result = build_command(name, &["--version"])
        // 標準出力をキャプチャする
        .stdout(std::process::Stdio::piped())
        // 標準エラーを捨てる（エラーは無視する）
        .stderr(std::process::Stdio::null())
        // コマンドを実行して出力を待つ
        .output();

    // コマンド実行結果によって found / version を決定する
    match result {
        // 実行成功かつ終了コードが 0 の場合はコマンドが見つかったと判断する
        Ok(output) if output.status.success() || !output.stdout.is_empty() => {
            // stdout を UTF-8 文字列に変換する（変換失敗時は空文字列）
            let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
            // 出力の最初の行をバージョン文字列として取得する
            let version = stdout_str
                // 改行で分割して最初の行を取得する
                .lines()
                // 最初の行のみ取得する
                .next()
                // 前後の空白を除去する
                .map(|l| l.trim().to_string())
                // 空文字列の場合は None にする
                .filter(|s| !s.is_empty());

            // Windows では where コマンドでパスを取得し、非 Windows では which 的な方法を使う
            let path = resolve_command_path(name);

            // コマンドが見つかった PrereqItem を返す
            PrereqItem {
                // コマンド名をそのまま格納する
                name: name.to_string(),
                // コマンドが見つかったことを示す
                found: true,
                // 解決したパス（取得できない場合は None）
                path,
                // バージョン文字列（取得できない場合は None）
                version,
                // インストール案内文をそのまま格納する
                install_hint: install_hint.to_string(),
            }
        }
        // コマンドが見つかったが終了コードが 0 以外の場合（--version 未対応コマンド等）
        Ok(output) if !output.stdout.is_empty() || !output.stderr.is_empty() => {
            // PATH 上には存在するがバージョン取得に失敗した場合でも found=true とする
            let path = resolve_command_path(name);
            // バージョン取得失敗でも PATH に存在することを示す PrereqItem を返す
            PrereqItem {
                // コマンド名をそのまま格納する
                name: name.to_string(),
                // コマンドが存在することを示す
                found: true,
                // 解決したパス（取得できない場合は None）
                path,
                // バージョンは取得できなかったことを示す
                version: None,
                // インストール案内文をそのまま格納する
                install_hint: install_hint.to_string(),
            }
        }
        // コマンドが見つからない場合（実行自体が失敗）はすべて未発見とする
        _ => {
            // コマンドが見つからなかった PrereqItem を返す
            PrereqItem {
                // コマンド名をそのまま格納する
                name: name.to_string(),
                // コマンドが見つからなかったことを示す
                found: false,
                // パスは取得できない
                path: None,
                // バージョンは取得できない
                version: None,
                // インストール案内文をそのまま格納する
                install_hint: install_hint.to_string(),
            }
        }
    }
}

// コマンド名からフルパスを解決するヘルパー関数
// Windows では `where` コマンド、非 Windows では `which` コマンドを使用する
fn resolve_command_path(name: &str) -> Option<String> {
    // Windows では where コマンドを使ってコマンドのフルパスを検索する
    #[cfg(windows)]
    {
        // `where <name>` を実行してフルパスを取得する
        let output = Command::new("where")
            // コマンド名を引数として渡す
            .arg(name)
            // 標準出力をキャプチャする
            .stdout(std::process::Stdio::piped())
            // 標準エラーを捨てる
            .stderr(std::process::Stdio::null())
            // 実行して出力を待つ
            .output()
            // 実行エラーの場合は None を返す
            .ok()?;
        // 出力を UTF-8 文字列に変換する
        let path_str = String::from_utf8_lossy(&output.stdout).to_string();
        // 最初の行（最初に見つかったパス）を取得して返す
        path_str
            // 改行で分割する
            .lines()
            // 最初の行を取得する
            .next()
            // 前後の空白を除去する
            .map(|l| l.trim().to_string())
            // 空文字列は None にする
            .filter(|s| !s.is_empty())
    }
    // 非 Windows では which コマンドを使用する
    #[cfg(not(windows))]
    {
        // `which <name>` を実行してフルパスを取得する
        let output = Command::new("which")
            // コマンド名を引数として渡す
            .arg(name)
            // 標準出力をキャプチャする
            .stdout(std::process::Stdio::piped())
            // 標準エラーを捨てる
            .stderr(std::process::Stdio::null())
            // 実行して出力を待つ
            .output()
            // 実行エラーの場合は None を返す
            .ok()?;
        // 出力を UTF-8 文字列に変換して最初の行を返す
        let path_str = String::from_utf8_lossy(&output.stdout).to_string();
        // 最初の行を取得して返す
        path_str
            // 改行で分割する
            .lines()
            // 最初の行を取得する
            .next()
            // 前後の空白を除去する
            .map(|l| l.trim().to_string())
            // 空文字列は None にする
            .filter(|s| !s.is_empty())
    }
}

// node / npm / npx / yarn / git の 5 コマンドの前提条件チェックを実行する関数
// 各コマンドが PATH 経由で実行可能かどうかを確認して PrereqReport を返す
pub fn check_prereqs() -> PrereqReport {
    // チェックするコマンドとインストール案内のリストを定義する
    let checks: &[(&str, &str)] = &[
        // Node.js ランタイムのチェック（Backstage / Verdaccio の実行に必須）
        (
            "node",
            "Node.js をインストールしてください: https://nodejs.org/",
        ),
        // npm パッケージマネージャーのチェック（Node.js に付属）
        (
            "npm",
            "npm は Node.js に含まれています: https://nodejs.org/",
        ),
        // npx コマンドランナーのチェック（create-app の実行に使用）
        (
            "npx",
            "npx は Node.js に含まれています: https://nodejs.org/",
        ),
        // yarn パッケージマネージャーのチェック（Backstage のビルドに必須）
        (
            "yarn",
            "yarn をインストールしてください: npm install -g yarn",
        ),
        // Git バージョン管理システムのチェック（Backstage の依存関係解決に使用）
        (
            "git",
            "Git をインストールしてください: https://git-scm.com/",
        ),
    ];

    // 各コマンドのチェック結果を格納するベクタ
    let mut items: Vec<PrereqItem> = Vec::new();

    // 各チェック項目を順番に確認する
    for (name, hint) in checks {
        // コマンド名とインストール案内を渡してチェック結果を取得する
        let item = check_single(name, hint);
        // チェック結果をリストに追加する
        items.push(item);
    }

    // 全コマンドが見つかったかどうかを判定する
    let all_ok = items.iter().all(|item| item.found);

    // チェック結果をまとめた PrereqReport を返す
    PrereqReport {
        // 各コマンドのチェック結果リストを格納する
        items,
        // 全コマンドが見つかった場合は true
        all_ok,
    }
}
