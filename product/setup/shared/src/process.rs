// このファイルは外部コマンド実行のユーティリティ関数を定義する
// Windows の .cmd シム対応や、stdout/stderr を Reporter にストリーミングする機能を提供する

// 外部コマンドを起動・制御するために使用する
use std::process::{Command, Stdio};

// I/O 読み取りに必要なトレイトをインポートする
use std::io::BufRead;

// 独自エラー型を参照するために使用する
use crate::error::SetupError;

// 進捗イベントを送信する Reporter を参照するために使用する
use crate::event::Reporter;

// Windows の .cmd シム（yarn.cmd, npm.cmd 等）に対応した Command ビルダ関数
// Windows では `cmd /c <program> <args>` でラップすることで .cmd ファイルを実行できる
pub fn build_command(program: &str, args: &[&str]) -> Command {
    // Windows 環境では cmd.exe 経由でコマンドを実行する
    #[cfg(windows)]
    {
        // cmd.exe を使ってコマンドを実行するための Command を作成する
        let mut cmd = Command::new("cmd");
        // /c オプションは指定されたコマンドを実行して cmd.exe を終了する
        cmd.arg("/c");
        // 実行するプログラム名を追加する（.cmd 拡張子は自動解決される）
        cmd.arg(program);
        // 追加の引数を順番に追加する
        for arg in args {
            // 各引数を個別に追加する
            cmd.arg(arg);
        }
        // 構築した Command を返す
        cmd
    }
    // 非 Windows 環境では直接コマンドを実行する
    #[cfg(not(windows))]
    {
        // プログラム名で Command を直接作成する
        let mut cmd = Command::new(program);
        // 追加の引数を順番に追加する
        for arg in args {
            // 各引数を個別に追加する
            cmd.arg(arg);
        }
        // 構築した Command を返す
        cmd
    }
}

// コマンドを実行して stdout/stderr を Reporter に 1 行ずつ送信するストリーミング実行関数
// 終了コードが 0 以外の場合は SetupError::CommandFailed を返す
pub fn run_streaming(
    mut cmd: Command,
    // 進捗イベントに付与するステップ ID
    step_id: &str,
    // 進捗イベントを送信する Reporter への参照
    reporter: &Reporter,
) -> Result<(), SetupError> {
    // コマンドのデバッグ文字列表現を構築する（エラーメッセージ用）
    let cmd_str = format!("{:?}", cmd);

    // stdout と stderr をパイプ（キャプチャ）に設定する
    cmd.stdout(Stdio::piped());
    // stderr もパイプ（キャプチャ）に設定する
    cmd.stderr(Stdio::piped());

    // コマンドを起動して子プロセスのハンドルを取得する
    let mut child = cmd.spawn().map_err(|e| SetupError::Io(e))?;

    // 子プロセスの stdout を取得する（spawn 後は Some になる）
    let stdout_handle = child.stdout.take();
    // 子プロセスの stderr を取得する（spawn 後は Some になる）
    let stderr_handle = child.stderr.take();

    // stderr を別スレッドで読み取るためのスレッドを起動する
    let stderr_thread = if let Some(stderr) = stderr_handle {
        // step_id を別スレッドで使えるように String にクローンする
        let step_id_clone = step_id.to_string();
        // Reporter をスレッドに移動するためにクローンするが Reporter は Clone 非対応のため
        // 代わりに stderr の各行をベクタに収集してメインスレッドで処理する設計にする
        // ここでは stderr を別スレッドで読んでキャッシュし、後でメインに返す
        let handle = std::thread::spawn(move || {
            // stderr のバッファリードを作成する
            let reader = std::io::BufReader::new(stderr);
            // stderr の全行を収集するベクタ
            let mut lines: Vec<String> = Vec::new();
            // 各行を順番に読み取る
            for line_result in reader.lines() {
                // 読み取り結果を確認する
                if let Ok(line) = line_result {
                    // step_id を含む情報として行を収集する
                    lines.push(line);
                }
                // step_id_clone は参照のみで使用（将来の拡張用として保持）
                let _ = &step_id_clone;
            }
            // 収集した stderr の行リストを返す
            lines
        });
        // スレッドハンドルを Some にラップして返す
        Some(handle)
    } else {
        // stderr が取得できない場合はスレッドを起動しない
        None
    };

    // stdout をメインスレッドで 1 行ずつ読み取って Reporter に送信する
    if let Some(stdout) = stdout_handle {
        // stdout のバッファリードを作成する
        let reader = std::io::BufReader::new(stdout);
        // 各行を順番に読み取る
        for line_result in reader.lines() {
            // 読み取り結果を確認する
            if let Ok(line) = line_result {
                // stdout の 1 行を Reporter 経由でイベントとして送信する
                reporter.stdout_line(step_id, &line);
            }
        }
    }

    // stderr スレッドの完了を待って収集した行を取得する
    if let Some(handle) = stderr_thread {
        // スレッドが完了するまで待機する
        if let Ok(stderr_lines) = handle.join() {
            // 収集した stderr の各行を Reporter 経由で送信する
            for line in stderr_lines {
                // stderr の 1 行を Reporter 経由でイベントとして送信する
                reporter.stderr_line(step_id, &line);
            }
        }
    }

    // 子プロセスの終了を待って終了ステータスを取得する
    let status = child.wait().map_err(|e| SetupError::Io(e))?;

    // 終了コードが 0 以外の場合はエラーを返す
    if !status.success() {
        // 終了コードを取得する（取得できない場合は -1 を使用）
        let code = status.code().unwrap_or(-1);
        // コマンド失敗エラーを返す
        return Err(SetupError::CommandFailed {
            // コマンドのデバッグ文字列を格納する
            cmd: cmd_str,
            // 終了コードを格納する
            code,
        });
    }

    // 正常終了を示す Ok(()) を返す
    Ok(())
}

// コマンドを実行して stdout を文字列で返す関数（短い出力を取得するためのユーティリティ）
// stderr は無視し、終了コードが 0 以外の場合は SetupError::CommandFailed を返す
pub fn run_output(mut cmd: Command) -> Result<String, SetupError> {
    // コマンドのデバッグ文字列表現を構築する（エラーメッセージ用）
    let cmd_str = format!("{:?}", cmd);

    // stdout をキャプチャするように設定する
    cmd.stdout(Stdio::piped());
    // stderr は無視する（出力を捨てる）
    cmd.stderr(Stdio::null());

    // コマンドを実行して全出力を一括取得する
    let output = cmd.output().map_err(|e| SetupError::Io(e))?;

    // 終了コードが 0 以外の場合はエラーを返す
    if !output.status.success() {
        // 終了コードを取得する（取得できない場合は -1 を使用）
        let code = output.status.code().unwrap_or(-1);
        // コマンド失敗エラーを返す
        return Err(SetupError::CommandFailed {
            // コマンドのデバッグ文字列を格納する
            cmd: cmd_str,
            // 終了コードを格納する
            code,
        });
    }

    // stdout のバイト列を UTF-8 文字列に変換して返す
    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();

    // 正常に取得した stdout 文字列を返す
    Ok(stdout_str)
}
